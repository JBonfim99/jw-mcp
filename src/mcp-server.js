import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { captionsTool, listVideosTool, handleCaptionsTool } from './tools/captions-tool.js';
import { dailyTools, handleDailyTools } from './tools/daily-tools.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { studyTools, handleStudyTools } from './tools/study-tools.js';
import {
  searchBibleBooksTool,
  getBibleVerseTool,
  getVerseWithStudyTool,
  getBibleVerseURLTool,
  handleScriptureTools,
} from './tools/scripture-tools.js';

const { version: SERVER_VERSION } = createRequire(import.meta.url)('../package.json');

const allTools = [
  ...studyTools,
  ...dailyTools,
  captionsTool,
  listVideosTool,
  searchBibleBooksTool,
  getBibleVerseTool,
  getVerseWithStudyTool,
  getBibleVerseURLTool,
];

const toolHandlers = [
  handleStudyTools,
  handleDailyTools,
  handleCaptionsTool,
  handleScriptureTools,
];

export function createMcpServer(requestId = 'default') {
  const server = new Server(
    { name: 'jw-mcp', version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error(`[${requestId}] ListTools — ${allTools.length} tools`);
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const start = Date.now();
    console.error(`[${requestId}] ToolCall: ${toolName}`);

    try {
      for (const handler of toolHandlers) {
        const result = await handler(request);
        if (result !== null) {
          const duration = Date.now() - start;
          const isError = result.isError || false;
          console.error(`[${requestId}] ToolResult: ${toolName} ${isError ? 'ERROR' : 'OK'} ${duration}ms`);
          return result;
        }
      }

      console.error(`[${requestId}] ToolResult: ${toolName} — no handler matched`);
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    } catch (error) {
      console.error(`[${requestId}] ToolError: ${toolName} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
  });

  return server;
}
