// src/commands.js
import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const commands = [
  {
    name: 'start',
    description: '註冊成為新用戶，並建立私人詞彙／閱讀頻道'
  },
  {
    name: 'review',
    description: '複習目前所有的詞彙與閱讀筆記'
  },
  {
    name: 'addnote',
    description: '手動新增一則閱讀筆記',
    options: [
      {
        type: 3,            // 3 = STRING
        name: 'source',
        description: '書名或文章標題',
        required: true
      },
      {
        type: 3,
        name: 'note',
        description: '閱讀心得或補充',
        required: true
      }
    ]
  }
  // 未來要新增 /addvocab、/plan、/quiz... 就在這裡繼續加
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Preparing to register commands…');

    // 這裡同時把測試與正式伺服器一起註冊
    const guilds = [
      process.env.TEST_GUILD_ID,
      process.env.PROD_GUILD_ID
    ].filter(Boolean);

    for (const guildId of guilds) {
      console.log(`→ Registering to guild ${guildId}…`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`   ✅ Done: ${guildId}`);
    }

    console.log('All done! Slash commands are live.');
  } catch (err) {
    console.error('❌ 註冊失敗：', err);
  }
})();

