// scripts/seed_kb.js
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';

// 1️⃣ 載入 .env
dotenv.config();

// 2️⃣ 初始化 Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 3️⃣ 初始化 OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 4️⃣ 靜態定義要 seed 的知識片段
const docs = [
  {
    source: 'FAQ',
    content: 'OAuth2 是一種授權協議，主要作用是讓第三方應用安全存取使用者的資源，而不必洩露使用者的密碼。'
  },
  {
    source: 'RangeExcerpt',
    content: '在《Range》這本書中，作者探討了專才與通才的優缺點，並舉例說明跨領域學習如何幫助人們解決複雜問題。'
  },
  {
    source: 'ChatGPTPrompting',
    content: '良好的 Prompt 設計應當包含：1) 明確的角色指令；2) 具體的輸入格式；3) 範例示範；4) 避免多義和模糊用詞。'
  }
  // 如果要更多片段，就繼續加在這裡
];

async function seed() {
  for (const { source, content } of docs) {
    console.log(`🔄 Seeding [${source}]…`);

    // 5️⃣ 呼叫 OpenAI Embedding API
    const embRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content
    });
    const vector = embRes.data[0].embedding;

    // 6️⃣ 插入到 Supabase knowledge_base
    const { error } = await supabase
      .from('knowledge_base')
      .insert([{ source, content, embedding: vector }]);

    if (error) {
      console.error(`❌ [${source}] seed failed:`, error.message);
    } else {
      console.log(`✅ [${source}] seeded.`);
    }
  }

  console.log('🎉 All knowledge seeded!');
  process.exit(0);
}

// 7️⃣ 執行 seed
seed();
