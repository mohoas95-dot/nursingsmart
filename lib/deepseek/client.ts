const KEYS = [
  process.env.DEEPSEEK_API_KEY_1,
  process.env.DEEPSEEK_API_KEY_2,
  process.env.DEEPSEEK_API_KEY_3,
].filter(Boolean);

export async function deepseekChat(prompt: string) {
  for (const key of KEYS) {
    try {
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: prompt }] }),
      });
      if (res.status === 429) continue; // Rate limit → fallback
      if (!res.ok) throw new Error(`DeepSeek error ${res.status}`);
      return await res.json();
    } catch {
      continue; // Try next key
    }
  }
  throw new Error("All DeepSeek keys exhausted or rate-limited.");
}
