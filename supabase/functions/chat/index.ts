import { serve } from "https://deno.land/std@0.184.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  const { user_id, message } = await req.json();
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("user_id", user_id)
    .order("created_at", { ascending: true })
    .limit(10);
  const systemPrompt = `你是一位專業的英文訓練助理，根據學生需求提供建議。`;
  const messages = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];
  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
    }),
  });
  const { choices } = await openaiRes.json();
  const reply = choices[0].message.content;
  await supabase.from("messages").insert([
    { user_id, role: "user", content: message },
    { user_id, role: "assistant", content: reply },
  ]);
  return new Response(JSON.stringify({ reply }), {
    headers: { "Content-Type": "application/json" },
  });
});
