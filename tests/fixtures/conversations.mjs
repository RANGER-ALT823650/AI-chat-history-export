export const conversations = [
  {
    platform: "Gemini",
    sourceUrl: "https://gemini.google.com/app/abc123456789",
    title: "全球市值最高的前十家公司是哪些？",
    conversationId: "abc123456789",
    conversationTime: "2026-04-05T09:30:00+08:00",
    messages: [
      {
        role: "user",
        content: "全球市值最高的前十家公司是哪些？"
      },
      {
        role: "assistant",
        content: "根据最新市场数据，前十家公司包括 NVIDIA、Apple、Alphabet、Microsoft、Amazon、Saudi Aramco、TSMC、Broadcom、Meta 和 Tesla。"
      }
    ]
  },
  {
    platform: "Grok",
    sourceUrl: "https://grok.com/chat/def123456789",
    title: "全球市值最高的前十家公司",
    conversationId: "def123456789",
    messages: [
      {
        role: "user",
        content: "全球市值最高的前十家公司是哪些？"
      },
      {
        role: "assistant",
        content: "NVIDIA、Apple、Alphabet、Microsoft、Amazon 等公司长期位居全球市值前列，具体排名会随股价变化。"
      }
    ]
  },
  {
    platform: "Claude",
    sourceUrl: "https://claude.ai/chat/ghi123456789",
    title: "环路积分符号怎么理解",
    conversationId: "ghi123456789",
    conversationTime: "2026-04-08T21:15:00+08:00",
    messages: [
      {
        role: "user",
        content: "我画线的地方有一个长得像积分符号的，那是什么？"
      },
      {
        role: "assistant",
        content: "那个符号是环路积分符号 ∮，表示沿封闭路径进行积分。在圆环问题里，它可以表示沿整个圆环周长累加。"
      }
    ]
  }
];
