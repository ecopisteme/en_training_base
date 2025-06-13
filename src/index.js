// src/index.js

import 'dotenv/config';
import http from 'http';
import { Client, IntentsBitField } from 'discord.js';
import { handleStart, handleReview } from './handlers/interaction.js';
import handleMessage from './handlers/message.js';

const port = process.env.PORT || 3000;
http.createServer((req,res)=>{res.writeHead(200);res.end('OK');})
  .listen(port, ()=>console.log(`Listening on ${port}`));

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent
  ]
});

client.once('ready', () => console.log(`Bot 已上線：${client.user.tag}`));

client.on('interactionCreate', async inter => {
  if (!inter.isCommand()) return;
  if (inter.commandName === 'start')  return handleStart(inter, client);
  if (inter.commandName === 'review') return handleReview(inter);
});

client.on('messageCreate', message => handleMessage(message, client));

client.login(process.env.DISCORD_TOKEN);
