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
        type: 3, // STRING
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
  },
  {
    name: 'addvocab',
    description: '手動新增一則詞彙',
    options: [
      {
        type: 3, // STRING
        name: 'word',
        description: '要新增的單字或片語',
        required: true
      },
      {
        type: 3,
        name: 'source',
        description: '詞彙出處（書名或文章）',
        required: false
      },
      {
        type: 3,
        name: 'page',
        description: '頁碼',
        required: false
      }
    ]
  },
  {
    name: 'plan',
    description: '根據主題生成一個 7 天練習計劃',
    options: [
      {
        type: 3,
        name: 'topic',
        description: '練習主題',
        required: true
      }
    ]
  },
  {
    name: 'quiz',
    description: '根據主題產生多選題',
    options: [
      {
        type: 4, // INTEGER
        name: 'num',
        description: '題目數量',
        required: true
      },
      {
        type: 3,
        name: 'topic',
        description: '測驗主題',
        required: true
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🛠 正在註冊 Slash Commands…');

    const guilds = [
      process.env.TEST_GUILD_ID,
      process.env.PROD_GUILD_ID
    ].filter(Boolean);

    for (const guildId of guilds) {
      console.log(`→ 註冊至伺服器 ${guildId} …`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`   ✅ 完成：${guildId}`);
    }

    console.log('🏁 所有 Slash Commands 已上線！');
  } catch (err) {
    console.error('❌ 註冊失敗：', err);
  }
})();
