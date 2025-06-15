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

    // 取得使用者輸入並去頭尾空格
  
    const text = message.content.trim();

// ── 1️⃣ 拆出 meta：若只輸入單字，直接當 meta；否則呼叫 OpenAI 拆 JSON ────────────────
let meta;
if (!text.includes(' ')) {
  // 使用者只輸入一個單字 → single_word 模式
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

  // 解析 JSON，並確保有 word 欄位；若解析失敗，fallback 回 single_word
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

// ── 2️⃣ 解構出最終要用的值 ───────────────────────────────────────────────
const { word, source_type, source_title, source_url, user_note } = meta;


// ─── 3️⃣ 用 GPT 產生連結式解釋 ──────────────────────────────────────
let explanation = '';
try {
  let messages;
  if (source_type === 'single_word') {
    // 单字模式，只给 Word，不给 Context
    messages = [
      { role: 'system', content: prompts.VOCAB },
      { role: 'user',   content: `Word: ${word}` }
    ];
  } else {
    // 其它模式，正常给 Word+Context
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

// ── 以下保留你原本的：寫回 Supabase、回覆 Discord 等所有後續邏輯 ──



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