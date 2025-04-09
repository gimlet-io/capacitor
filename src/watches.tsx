export const watchResource = async (path: string, callback: (event: any) => void, controller: AbortController, setWatchStatus: (status: string) => void) => {
  try {
    const response = await fetch(path, { signal: controller.signal });
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    setWatchStatus("●");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            callback(event);
          } catch (e) {
            console.log(line);
            console.error('Error parsing watch event:', e);
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Watch aborted:', path);
      return;
    }
    console.error('Watch error:', error);
    setWatchStatus("○");
    setTimeout(() => {
      console.log('Restarting watch:', path);
      watchResource(path, callback, controller, setWatchStatus);
    }, 5000);
  }
};
