// src/index.js

// ---- For Render 健康檢查 ----
import http from 'http';
const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
  })
  .listen(port, () => {
    console.log(`Listening on port ${port}`);
  });

// ---- Discord.js & 權限常數 ----
import {
  Client,
  IntentsBitField,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';

// ---- 環境變數 + 初始化 Supabase/OpenAI ----
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import prompts from './prompts.js';
import { channelRoutes } from './handlers/index.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---- 建立 Discord Client ----
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers
  ]
});



// ---- Helper: 建／取「閱讀筆記」頻道 ----

/**
 * 幫 user 建立／取得私密「閱讀筆記」頻道
 */
async function handleReadingChannel(interaction, profileId) {
  const guild    = interaction.guild;
  const username = interaction.user.username;
  // 用 username 動態計算 Category 名
  const categoryName = `${username}私人訓練頻道`;

  // 1️⃣ 找或創 Category
  let cat = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory &&
    c.name === categoryName
  );
  if (!cat) {
    cat = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory
    });
  }

  // 2️⃣ 建／取 user 專屬頻道
  const channelName = `📖 閱讀筆記 -${username}`;
  let ch = guild.channels.cache.find(c =>
    c.parentId === cat.id &&
    c.name === channelName
  );
  if (!ch) {
    ch = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: cat.id,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: client.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    });
  }

  // 3️⃣ 存入 Supabase
  const { error } = await supabase
    .from('user_channels')
    .upsert(
      { profile_id: profileId, reading_channel_id: ch.id },
      { onConflict: 'profile_id' }
    );
  if (error) console.error('[handleReadingChannel] ', error);

  return ch;
}


// ---- Helper: 建／取「詞彙累積」頻道 ----
/**
 * 幫 user 建立／取得私密「詞彙累積」頻道
 */
async function handleVocabChannel(interaction, profileId) {
  const guild    = interaction.guild;
  const username = interaction.user.username;
  // 用 username 動態計算 Category 名
  const categoryName = `${username}私人訓練頻道`;

  // 1️⃣ 找或創 Category
  let cat = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory &&
    c.name === categoryName
  );
  if (!cat) {
    cat = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory
    });
  }

  // 2️⃣ 建／取 user 專屬頻道
  const channelName = `🔖 詞彙累積 -${username}`;
  let ch = guild.channels.cache.find(c =>
    c.parentId === cat.id &&
    c.name === channelName
  );
  if (!ch) {
    ch = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: cat.id,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: client.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    });
  }

  // 3️⃣ 存入 Supabase
  const { error } = await supabase
    .from('user_channels')
    .upsert(
      { profile_id: profileId, vocab_channel_id: ch.id },
      { onConflict: 'profile_id' }
    );
  if (error) console.error('[handleVocabChannel] ', error);

  return ch;
}


// ---- Bot Ready ----
client.once('ready', () => {
  console.log(`已登入 Discord：${client.user.tag}`);
});

// ================================================
// /start 指令：註冊、建立私密頻道並寫入 user_channels
// ================================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand() || interaction.commandName !== 'start')
    return;
  await interaction.deferReply({ ephemeral: true });

  try {
    // 1. Upsert profile 並取回 id
    const { data: prof, error: pe } = await supabase
      .from('profiles')
      .upsert(
        {
          discord_id: interaction.user.id,
          username: interaction.user.username
        },
        { onConflict: 'discord_id', returning: 'representation' }
      );
    if (pe || !prof || prof.length === 0) {
      throw new Error(pe?.message || 'Profiles upsert 失敗');
    }
    const profileId = prof[0].id;

    const guild = interaction.guild;

    // 2. 檢查是否已經建立過
    const { data: uc } = await supabase
      .from('user_channels')
      .select('vocab_channel_id,reading_channel_id')
      .eq('profile_id', profileId)
      .single();

    if (uc?.vocab_channel_id && uc?.reading_channel_id) {
      // 確認頻道仍在
      const [vOK, rOK] = await Promise.all([
        guild.channels.fetch(uc.vocab_channel_id).then(() => true).catch(() => false),
        guild.channels.fetch(uc.reading_channel_id).then(() => true).catch(() => false)
      ]);
      if (vOK && rOK) {
        return interaction.followUp({
          content: [
            '✅ 你已經有專屬頻道：',
            `• 🔖 詞彙累積 → <#${uc.vocab_channel_id}>`,
            `• 📖 閱讀筆記 → <#${uc.reading_channel_id}>`
          ].join('\n'),
          ephemeral: true
        });
      }
    }

    // 3. 建立 / 取得 Category
    // 取得或建立 Category（改用 username + 私人訓練頻道）
const username     = interaction.user.username;
const categoryName = `${username}私人訓練頻道`;
let category = guild.channels.cache.find(c =>
  c.type === ChannelType.GuildCategory &&
  c.name === categoryName
);
if (!category) {
  category = await guild.channels.create({
    name: categoryName,
    type: ChannelType.GuildCategory
  });
}


    // 4. 權限設定
    const overwrites = [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages
        ]
      }
    ];

    // 5. 建立私密子頻道
    const vocabChan = await guild.channels.create({
      name: `🔖 詞彙累積 -${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites
    });
    const readingChan = await guild.channels.create({
      name: `📖 閱讀筆記 -${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites
    });

    // 6. Upsert user_channels
    await supabase
      .from('user_channels')
      .upsert(
        {
          profile_id: profileId,
          vocab_channel_id: vocabChan.id,
          reading_channel_id: readingChan.id
        },
        { onConflict: 'profile_id' }
      );

    // 7. 回覆
    await interaction.followUp({
      content: [
        '✅ 私密頻道已建立：',
        `• 🔖 詞彙累積 → <#${vocabChan.id}>`,
        `• 📖 閱讀筆記 → <#${readingChan.id}>`
      ].join('\n'),
      ephemeral: true
    });
  } catch (err) {
    console.error('[/start 處理失敗]', err);
    await interaction.followUp({
      content: `❌ 註冊或頻道建立失敗：${err.message}`,
      ephemeral: true
    });
  }
});

// ================================================
// messageCreate：動態路由到對應 handler
// ================================================
client.on('messageCreate', async (message) => {
  // 忽略機器人
  if (message.author.bot) return;

  // 只在測試或正式伺服器回應
  const gid = message.guild.id;
  if (
    process.env.NODE_ENV === 'development'
      ? gid !== process.env.TEST_GUILD_ID
      : gid !== process.env.PROD_GUILD_ID
  ) {
    return;
  }

  // 拿 profileId
  const { data: prof, error: pe } = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', message.author.id)
    .single();
  if (pe || !prof) {
    return message.reply('❌ 請先執行 /start 註冊');
  }
  const profileId = prof.id;

  // 拿 user_channels
  const { data: uc, error: ue } = await supabase
    .from('user_channels')
    .select('vocab_channel_id,reading_channel_id')
    .eq('profile_id', profileId)
    .single();
  if (ue) {
    console.error('[user_channels 讀取失敗]', ue);
    return;
  }

  // 動態路由
  for (const route of channelRoutes) {
    const chanId = uc[route.key];
    if (chanId && message.channel.id === chanId) {
      return route.handler(message);
    }
  }

  // /review 指令
  if (message.content.trim().startsWith('/review')) {
    const { default: ReviewHandler } = await import(
      './handlers/review.js'
    );
    return ReviewHandler.process(message);
  }
});

// ---- 啟動 Bot ----
client.login(process.env.DISCORD_TOKEN);

