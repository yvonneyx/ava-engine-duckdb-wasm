import { escapeMarkdown, markdownTable } from './markdown.js';
import type { DataModel, Properties } from '../types.js';

/** Describe each semantic object separately, retaining source mappings, properties and observations. */
export function stringifyDataModel({ description, ...dataModel }: DataModel): string {
  const attributes = (value: object): string =>
    markdownTable(Object.entries(value).map(([key, value]) => ({ Attribute: key, Value: value })));
  const metadata = ({ properties, metrics, ...value }: { properties?: Properties; metrics?: Properties }): string =>
    [
      attributes(value),
      properties && Object.keys(properties).length ? `Properties:\n\n${attributes(properties)}` : '',
      metrics && Object.keys(metrics).length ? `Metrics:\n\n${attributes(metrics)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  const sections = ['# Data Model'];

  if (description !== undefined) sections.push(attributes({ description }));

  if (dataModel.properties && Object.keys(dataModel.properties).length) {
    sections.push('## Properties', attributes(dataModel.properties));
  }

  if (dataModel.models?.length) {
    sections.push('## Models');
    for (const { name, columns, ...model } of dataModel.models) {
      sections.push(`### Model: ${escapeMarkdown(name)}`, metadata(model));
      if (columns?.length) {
        sections.push('#### Columns');
        for (const { name, type, ...column } of columns) {
          const summary = [
            `${name} (${type})`,
            column.isCalculated && column.expression ? `[calculated: ${column.expression}]` : '',
            column.relationship ? `[relationship: ${column.relationship}]` : '',
            column.notNull ? 'NOT NULL' : '',
            column.isPrimaryKey ? 'PRIMARY KEY' : '',
          ]
            .filter(Boolean)
            .join(' ');
          sections.push(`- ${escapeMarkdown(summary)}`, metadata(column));
        }
      }
    }
  }

  if (dataModel.relationships?.length) {
    sections.push('## Relationships');
    for (const { name, ...relationship } of dataModel.relationships) {
      const [from, to] = relationship.models;
      sections.push(
        `### Relationship: ${escapeMarkdown(name)}`,
        escapeMarkdown(`${from} → ${to} (${relationship.joinType})`),
        metadata(relationship)
      );
    }
  }

  if (dataModel.views?.length) {
    sections.push('## Views');
    for (const { name, ...view } of dataModel.views) {
      sections.push(`### View: ${escapeMarkdown(name)}`, metadata(view));
    }
  }

  if (dataModel.cubes?.length) {
    sections.push('## Cubes');
    for (const { name, measures, dimensions, timeDimensions, hierarchies, ...cube } of dataModel.cubes) {
      sections.push(`### Cube: ${escapeMarkdown(name)}`, metadata(cube));
      for (const [label, fields] of [
        ['Measures', measures],
        ['Dimensions', dimensions],
        ['Time dimensions', timeDimensions],
      ] as const) {
        if (!fields?.length) continue;
        sections.push(`#### ${label}`);
        for (const { name, type, ...field } of fields) {
          sections.push(`- ${escapeMarkdown(`${name} (${type})`)}`, metadata(field));
        }
      }
      if (hierarchies && Object.keys(hierarchies).length) {
        sections.push(
          '#### Hierarchies',
          ...Object.entries(hierarchies).map(
            ([name, levels]) => `- ${escapeMarkdown(`${name}: ${levels.join(' → ')}`)}`
          )
        );
      }
    }
  }

  // TODO: Above 30,000 characters, retrieve question-relevant context with embeddings; keep full context for now.
  return sections.filter(Boolean).join('\n\n');
}
