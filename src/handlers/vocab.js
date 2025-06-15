// src/handlers/vocab.js
import dotenv from 'dotenv';
dotenv.config();

import { supabase, openai } from '../lib/clients.js';
import prompts from '../prompts.js';

/**
 * 處理「詞彙累積」專屬頻道訊息
 */
export async function processVocab(message) {
  // （前面 profile 部分保留不動）
  const profileRes = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', message.author.id)
    .single();
  if (profileRes.error || !profileRes.data) {
    return message.reply('❌ 請先執行 /start 註冊');
  }
  const profileId = profileRes.data.id;

  // ── ① 取使用者文字並拆出 meta ─────────────────────────────────────
  // 先去頭尾空格
  const raw = message.content.trim();
  // 只刪掉最前面的 @機器人 mention（如果有的話）
  const text = raw.replace(
    new RegExp(`^<@!?${message.client.user.id}>`), ''
  ).trim();

  console.log('[DEBUG] cleaned text:', JSON.stringify(text));
  if (!text) {
    return message.reply('❌ 你好像沒打字哦！只要在這裡貼一個單字就好。');
  }

  let meta;
  if (!text.includes(' ')) {
    // 使用者只輸入一個單字 → single_word
    meta = {
      word:        text,
      source_type: 'single_word',
      source_title:'',
      source_url:  '',
      user_note:   ''
    };
  } else {
    // 使用者輸入句子 → 呼叫 OpenAI 拆 JSON
    let aiContent = '';
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `
你是「詞彙來源擷取器」。輸入一段訊息後，請輸出純 JSON，結構：
{
  "word":"<單字>",
  "source_type":"<link|book|article|video|podcast|sentence>",
  "source_title":"<書名或標題…>",
  "source_url":"<URL 或空字串>",
  "user_note":"<使用者心得或空字串>"
}
只回 JSON，不要額外文字。`
          },
          { role: 'user', content: text }
        ],
        temperature: 1
      });
      aiContent = resp.choices[0].message.content;
    } catch (err) {
      console.error('[Vocab OpenAI Err]', err);
      return message.reply('❌ 無法擷取詞彙來源，請稍後再試');
    }

    try {
      const parsed = JSON.parse(aiContent);
      if (!parsed.word) throw new Error('Missing word');
      meta = parsed;
    } catch (err) {
      console.warn('[Vocab parse failed → fallback]', aiContent, err);
      meta = {
        word:        text,
        source_type: 'single_word',
        source_title:'',
        source_url:  '',
        user_note:   ''
      };
    }
  }

  // ── ② 解構出最終要用的值 ────────────────────────────────────────────────
  const { word, source_type, source_title, source_url, user_note } = meta;

  // ③ 用 GPT 產生解釋
  let explanation = '';
  try {
    let messages;
    if (source_type === 'single_word') {
      messages = [
        { role: 'system', content: prompts.VOCAB },
        { role: 'user',   content: `Word: ${word}` }
      ];
    } else {
      const contextLine = source_type + (source_title ? ` — ${source_title}` : '');
      messages = [
        { role: 'system', content: prompts.VOCAB },
        { role: 'user',   content: `Word: ${word}\nContext: ${contextLine}` }
      ];
    }

    const defi = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      temperature: 1
    });
    explanation = defi.choices[0].message.content.trim();
  } catch (e) {
    console.error('[Vocab Explanation Err]', e);
    explanation = '(無法取得解釋)';
  }

  // ④ 寫入 Supabase
  const { error: dbErr } = await supabase.from('vocabulary').insert([{
    user_id:       profileId,
    word,
    source:        source_title || null,
    page:          null,
    response:      explanation,
    source_type,
    source_title:  source_title || null,
    source_url:    source_url   || null,
    user_note:     user_note    || null
  }]);
  if (dbErr) {
    console.error('[Vocab DB Err]', dbErr);
    return message.reply('❌ 儲存單字失敗，請稍後再試');
  }

  // ⑤ 回覆 Discord
  return message.reply(
    [
      `**🔖 ${word}**`,
      explanation,
      '',
      `> 來源：${source_type}${source_title? ' — '+source_title: ''}`,
      source_url  ? `> 連結：${source_url}`   : '',
      user_note   ? `> 筆記：${user_note}`     : '',
      '',
      '✅ 已記錄到你的詞彙累積'
    ]
    .filter(Boolean)
    .join('\n')
  );
}

export { processVocab as handleVocab };