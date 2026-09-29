export function embedInstallation(origin: string, flowId: string) {
  return `<script src="${origin}/embed.js"></script>
<script>
  Agentflows.mount({
    url: ${JSON.stringify(origin)},
    flowId: ${JSON.stringify(flowId)},
    getToken: async () => {
      const response = await fetch('/api/chat-access', { method: 'POST' });
      if (!response.ok) throw new Error('Entre na aplicação para conversar.');
      return response.json();
    }
  });
</script>`;
}
