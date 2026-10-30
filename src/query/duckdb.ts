import { generateText } from 'ai';

import { languageModel } from '../util/model.js';
import { stringifyDataModel } from '../util/data-model.js';

import type { LLMConfig, DataModel } from '../types.js';

export class DuckDBQueryDialect {
  constructor(private readonly llmConfig: LLMConfig) {}

  async getDSL(query: string, dataModel: DataModel): Promise<string> {
    const prompt = `You are a SQL expert. Given the following dataset profile and user query, generate a SQL query to answer the question.

Dataset Context:
${stringifyDataModel(dataModel)}

User Query: ${query}

Generate ONLY the SQL query without any explanation or markdown formatting. Reference the tables and fields by their exact names shown above (join tables when the question spans multiple tables). Use DuckDB SQL syntax.`;

    const { text, usage } = await generateText({
      model: languageModel(this.llmConfig),
      maxRetries: this.llmConfig.maxRetries ?? 3,
      prompt,
    });
    this.llmConfig.onQueryUsage?.(usage);

    return text
      .trim()
      .replace(/^```(?:sql)?\s*|\s*```$/gi, '')
      .trim();
  }

}
