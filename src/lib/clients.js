// src/lib/clients.js
import dotenv from "dotenv";
dotenv.config(); // 保证环境变量生效

import { createClient } from "@supabase/supabase-js";
import { OpenAI } from "openai";

// supabase 客户端
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// openai 客户端
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
