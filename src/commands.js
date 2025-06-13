// src/commands.js
import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const commands = [
  {
    name: 'start',
    description: '註冊成為新用戶'
  }
  // 如果後續還要新增 /addnote、/review 等命令，就繼續放在這裡
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Preparing to register commands…');

    // 把要註冊的伺服器 ID 蒐集成一個陣列
    const guilds = [
      process.env.TEST_GUILD_ID,
      process.env.PROD_GUILD_ID
    ].filter(Boolean);  // 只取有設定的

    // 逐一對每個 Guild 呼叫 Discord API
    for (const guildId of guilds) {
      console.log(`→ Registering to guild ${guildId}…`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`   ✅ Done: ${guildId}`);
    }

    console.log('All done! Slash commands are live in both environments.');
  } catch (err) {
    console.error('❌ 註冊失敗：', err);
  }
})();

