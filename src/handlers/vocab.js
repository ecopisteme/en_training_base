// src/handlers/vocab.js
import dotenv from 'dotenv';
dotenv.config();

import { supabase, openai } from '../lib/clients.js';
import prompts from '../prompts.js';

/**
 * 處理「詞彙累積」專屬頻道訊息
 */
export async function processVocab(message) {
  // 先取 profileId
  const profileRes = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', message.author.id)
    .single();
  if (profileRes.error || !profileRes.data) {
    return message.reply('❌ 請先執行 /start 註冊');
  }
  const profileId = profileRes.data.id;

  const text = message.content.trim();

// 1️⃣ 如果用户只贴一个单词，就跳过调用 OpenAI
let meta;
if (!text.includes(' ')) {
  meta = {
    word: text,
    source_type: 'single_word',
    source_title: '',
    source_url: '',
    user_note: ''
  };
} else {
  // 1a️⃣ 否则调用 OpenAI 拆 JSON
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
  "source_type":"<link|book|article|video|podcast|sentence|single_word>",
  "source_title":"<書名或標題…>",
  "source_url":"<URL 或空字串>",
  "user_note":"<使用者心得或空字串>"
}
只回 JSON，不要任何多餘文字。`
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

  // 1b️⃣ 解析 JSON，并确保有 word 字段
  try {
    const parsed = JSON.parse(aiContent);
    if (!parsed.word) throw new Error('Missing word');
    meta = parsed;
  } catch (err) {
    console.error('[Vocab parse failed → fallback]', aiContent, err);
    return await message.reply('❌ 無法擷取詞彙來源，請稍後再試');
  }
}

// 1c️⃣ 解构出最终使用的字段
const { word, source_type, source_title, source_url, user_note } = meta;

  // ─── 2️⃣ 解析 JSON，parse 失敗就 fallback single_word ───────────────
  
  try {
    meta = JSON.parse(aiContent);
    if (!meta.word) throw new Error('Missing word');
  } catch (err) {
    console.warn('[Vocab parse failed → fallback]', err);
    meta = {
      word:        text,
      source_type: 'single_word',
      source_title:'',
      source_url:  '',
      user_note:   ''
    };
  }

  const { word, source_type, source_title, source_url, user_note } = meta;

  // ─── 3️⃣ 用 GPT 產生連結式解釋 ──────────────────────────────────────
  let explanation = '';
  try {
    const defi = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: prompts.VOCAB },
        {
          role: 'user',
          content: `Word: ${word}\nContext: ${source_type}${source_title? ' — '+source_title: ''}`
        }
      ],
      temperature: 1
    });
    explanation = defi.choices[0].message.content.trim();
  } catch (e) {
    console.error('[Vocab Explanation Err]', e);
    explanation = '(無法取得解釋)';
  }

  // ─── 4️⃣ 寫入 Supabase ────────────────────────────────────────────
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

  // ─── 5️⃣ 回覆 Discord ────────────────────────────────────────────
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

// 最後別忘了把 processVocab 當 handler 匯出
export { processVocab as handleVocab };