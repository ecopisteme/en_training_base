// src/handlers/vocab.js
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import prompts from '../prompts.js';
import dotenv from 'dotenv';
dotenv.config();

// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
// OpenAI client
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 處理「詞彙累積」專屬頻道訊息
 */
export async function process(message) {
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

  // 1️⃣ 用 GPT 提取：word, source_type, source_title, source_url, user_note
  let meta = {};
  try {
    const extractResp = await openai.chat.completions.create({
      model: 'GPT-4.1 nano',
      messages: [
        {
          role: 'system',
          content: `
你是「詞彙來源擷取器」。輸入一段訊息後，請輸出純 JSON，結構：
{
  "word":    "<要查的單字>",
  "source_type":"<link|book|article|video|podcast|sentence>",
  "source_title":"<書名或文章標題或影片名稱或原句…>",
  "source_url":"<如有連結就填，否則空字串>",
  "user_note":"<使用者自己補充的心得，可空>"
}

範例1：
輸入：我在 YouTube 看到一段影片「如何背單字」裡有 wordplay 這個字
輸出：
{"word":"wordplay","source_type":"video","source_title":"如何背單字","source_url":"","user_note":""}

範例2：
輸入：Here's a cool link: https://example.com/article.html about serendipity
輸出：
{"word":"serendipity","source_type":"link","source_title":"","source_url":"https://example.com/article.html","user_note":""}

只輸出 JSON，不要其他文字。
`
        },
        { role: 'user', content: text }
      ],
      temperature: 3
    });
    meta = JSON.parse(extractResp.choices[0].message.content);
  } catch (e) {
    console.error('[Vocab Extraction 錯誤]', e);
    return message.reply('❌ 無法擷取詞彙來源，請確認輸入格式');
  }

  const { word, source_type, source_title, source_url, user_note } = meta;

  // 2️⃣ 用 GPT 產生連結式解釋
  let explanation = '';
  try {
    const defi = await openai.chat.completions.create({
      model: 'GPT-4.1 mini',
      messages: [
        { role: 'system', content: prompts.VOCAB },
        { role: 'user',   content: `Word: ${word}\nContext: ${source_type} ${source_title}` }
      ],
      temperature: 3
    });
    explanation = defi.choices[0].message.content.trim();
  } catch (e) {
    console.error('[Vocab Explanation 錯誤]', e);
    explanation = '(無法取得解釋)';
  }

  // 3️⃣ 寫入 Supabase
  const { error: dbErr } = await supabase.from('vocabulary').insert([{
    user_id:     profileId,
    word,
    source:      source_title || null,
    page:        null,
    response:    explanation,
    source_type,
    source_title: source_title || null,
    source_url:   source_url   || null,
    user_note:    user_note    || null
  }]);
  if (dbErr) {
    console.error('[Vocab DB 寫入失敗]', dbErr);
    return message.reply('❌ 儲存單字失敗，請稍後再試');
  }

  // 4️⃣ 回覆 Discord
  return message.reply([
    `**🔖 ${word}**`,
    explanation,
    '',
    `> 來源：${source_type}${source_title? ' — '+source_title: ''}${source_url? '\n> 連結：'+source_url: ''}`,
    user_note ? `> 筆記：${user_note}` : '',
    '',
    '✅ 已記錄到你的詞彙累積'
  ].filter(Boolean).join('\n'));
}


export default handleVocab;