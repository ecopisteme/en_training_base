// src/handlers/message.js
import prompts from '../prompts.js';
import { supabase, openai } from '../lib/clients.js';

export default async function handleMessage(message) {
  if (message.author.bot) return;

  // 只在私頻裡
  const { data: prof } = await supabase
    .from('profiles').select('id').eq('discord_id', message.author.id).single();
  if (!prof) return;
  const pid = prof.id;

  const { data: uc } = await supabase
    .from('user_channels')
    .select('vocab_channel_id,reading_channel_id')
    .eq('profile_id', pid)
    .single();
  if (!uc) return;

  const cid = message.channel.id;
  if (cid !== uc.vocab_channel_id && cid !== uc.reading_channel_id) return;

  // 只示範 vocab 模式，reading 模式請自行照 function-calling 加入
  if (cid === uc.vocab_channel_id) {
    const term = message.content.trim();
    // 呼叫 GPT 拿解釋
    let def;
    try {
      const vr = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages:[
          { role:'system', content: prompts.VOCAB },
          { role:'user', content:`Word: ${term}` }
        ]
      });
      def = vr.choices[0].message.content;
    } catch {
      def = '(無法取得解釋)';
    }
    //寫入 vocabulary，包含 response
    await supabase.from('vocabulary').insert([{
      user_id: pid,
      word:     term,
      source:   message.channel.name,  // 或者其他你要的來源標記
      page:     null,
      response: definition
    }]);
    // 回覆
    return message.reply(`**${term}**：\n${def}`);
  }

  // cid === reading_channel_id 的話就走你的 SMART_CLASSIFIER + record_actions… 
}
