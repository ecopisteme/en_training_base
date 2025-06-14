import { processVocab }   from './vocab.js';
import { processReading } from './reading.js';

/**
 * 處理一般文字訊息
 * @param {Message} message - discord.js Message 物件
 * @param {Client} client   - Discord Client
 * @param {Map<string,{vocab:string,reading:string}>} channelMap - 快取
 */
export async function handleMessage(message, client, channelMap) {
  if (message.author.bot) return;            // 跳過機器人自己

  const chInfo = channelMap.get(message.author.id);
  if (!chInfo) return;                       // 尚未 /start

  // 詞彙累積頻道
  if (message.channelId === chInfo.vocab) {
    return processVocab(message);
  }

  // 閱讀筆記頻道
  if (message.channelId === chInfo.reading) {
    return processReading(message);
  }
}