// src/handlers/vocab.js
import dotenv from 'dotenv';
dotenv.config();

import { supabase, openai } from '../lib/clients.js';
import prompts from '../prompts.js';

export async function processVocab(message) {
  // 0️⃣ 取 profile
  const profileRes = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', message.author.id)
    .single();
  if (profileRes.error || !profileRes.data) {
    return message.reply('❌ 請先執行 /start 註冊');
  }
  const profileId = profileRes.data.id;

  // ① 拆 meta：去掉 mention、trim，單字直接走 single_word，句子才呼叫 OpenAI 拆 JSON
  const raw = message.content.trim();
  const text = raw.replace(/<@!?\d+>/g, '').trim();

  let meta;
  if (!text.includes(' ')) {
    // 使用者只輸入一個單字
    meta = {
      word:        text,
      source_type: 'single_word',
      source_title: '',
      source_url:   '',
      user_note:    ''
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
只回 JSON，不要其他文字。`
          },
          { role: 'user', content: text }
        ],
        temperature: 1
      });
      aiContent = resp.choices[0].message.content;
    } catch (err) {
      console.error('[Vocab OpenAI Err]', err);
      return await message.reply('❌ 無法擷取詞彙來源，請稍後再試');
    }

    // 只在這裡 parse JSON 並 fallback，之後不再重 parse
    try {
      const parsed = JSON.parse(aiContent);
      if (!parsed.word) throw new Error('Missing word');
      meta = parsed;
    } catch (err) {
      console.warn('[Vocab parse failed → fallback]', aiContent, err);
      meta = {
        word:        text,
        source_type: 'single_word',
        source_title: '',
        source_url:   '',
        user_note:    ''
      };
    }
  }

  // ② 解構出要用的欄位
  const { word, source_type, source_title, source_url, user_note } = meta;

  // ─── 3️⃣ 用 GPT 產生連結式解釋 ──────────────────────────────────────
   
  let explanation = '';
  try {
    // 不要 special‐case，永遠給它 Word + Context 兩行
    const contextLine = source_type === 'single_word'
      ? 'single_word'
      : source_type + (source_title ? ` — ${source_title}` : '');

    const messages = [
      { role: 'system', content: prompts.VOCAB },
      { role: 'user',   content: `Word: ${word}\nContext: ${contextLine}` }
    ];

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

  // ─── 4️⃣ 寫入 Supabase ────────────────────────────────────────────
  const { error: dbErr } = await supabase.from('vocabulary').insert([{
    user_id:      profileId,
    word,
    source:       source_title || null,
    page:         null,
    response:     explanation,
    source_type,
    source_title: source_title || null,
    source_url:   source_url   || null,
    user_note:    user_note    || null
  }]);
  if (dbErr) {
    console.error('[Vocab DB Err]', dbErr);
    return message.reply('❌ 儲存單字失敗，請稍後再試');
  }

  // ─── 5️⃣ 回覆 Discord ────────────────────────────────────────────
  return message.reply(
    [
      `**🔖 ${word}**`,
      explanation,
      '',
      `> 來源：${source_type}${source_title? ' — '+source_title: ''}`,
      source_url ? `> 連結：${source_url}` : '',
      user_note  ? `> 筆記：${user_note}` : '',
      '',
      '✅ 已記錄到你的詞彙累積'
    ].filter(Boolean).join('\n')
  );
}

// 最後別忘了匯出 handler
export { processVocab as handleVocab };