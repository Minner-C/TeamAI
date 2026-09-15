import http from "node:http";

const PORT = Number(process.env.MOCK_UPSTREAM_PORT ?? 8898);

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [
          { id: "demo-model", object: "model" },
          { id: "demo-model-pro", object: "model" },
        ] }));
        return;
      }
      if (req.url !== "/v1/chat/completions") {
        res.writeHead(404).end();
        return;
      }
      const reply =
        "你好！我是 mock 上游模型的回复。链路：客户端 → TeamAI 网关 → 上游 API，token 用量已自动记录。";
      if (json.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        let i = 0;
        const timer = setInterval(() => {
          if (i >= reply.length) {
            clearInterval(timer);
            res.write(
              `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 30, completion_tokens: Math.ceil(reply.length / 2) } })}\n\n`,
            );
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply[i++] } }] })}\n\n`);
        }, 20);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-mock",
            model: json.model,
            choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
            usage: { prompt_tokens: 30, completion_tokens: Math.ceil(reply.length / 2), total_tokens: 60 },
          }),
        );
      }
    });
  })
  .listen(PORT, () => console.log(`mock upstream on :${PORT}`));
