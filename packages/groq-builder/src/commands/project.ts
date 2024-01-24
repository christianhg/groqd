import { notNull, Simplify } from "../types/utils";
import { GroqBuilder } from "../groq-builder";
import { Parser, ParserFunction } from "../types/public-types";
import { isParser, normalizeValidationFunction } from "./validate-utils";
import { InferResultItem, OverrideResultItem } from "../types/result-types";
import {
  ExtractProjectionResult,
  ProjectionFieldConfig,
  ProjectionMap,
} from "./projection-types";
import { isConditional } from "./conditional-types";
import {
  simpleArrayParser,
  simpleObjectParser,
} from "../validation/simple-validation";
import { inferSymbol } from "./functions/infer";

declare module "../groq-builder" {
  export interface GroqBuilder<TResult, TRootConfig> {
    /**
     * Performs an "object projection", returning an object with the fields specified.
     */
    project<TProjection extends ProjectionMap<InferResultItem<TResult>>>(
      projectionMap:
        | TProjection
        | ((
            q: GroqBuilder<InferResultItem<TResult>, TRootConfig>
          ) => TProjection)
    ): GroqBuilder<
      OverrideResultItem<
        TResult,
        Simplify<ExtractProjectionResult<InferResultItem<TResult>, TProjection>>
      >,
      TRootConfig
    >;
  }
}

GroqBuilder.implement({
  project(
    this: GroqBuilder,
    projectionMapArg: object | ((q: any) => object)
  ): GroqBuilder<any> {
    // Retrieve the projectionMap:
    let projectionMap: object;
    if (typeof projectionMapArg === "function") {
      projectionMap = projectionMapArg(this.root);
    } else {
      projectionMap = projectionMapArg;
    }

    // Compile query from projection values:
    const keys = Object.keys(projectionMap) as Array<string>;
    const fields = keys
      .map((key) => {
        const fieldConfig = projectionMap[key as keyof typeof projectionMap];
        return normalizeProjectionField(key, fieldConfig);
      })
      .filter(notNull);

    const queries = fields.map((v) => v.query);
    const { newLine, space } = this.indentation;
    const newQuery = ` {${newLine}${space}${queries.join(
      `,${newLine}${space}`
    )}${newLine}}`;

    // Create a combined parser:
    const projectionParser = createProjectionParser(fields);

    return this.chain(newQuery, projectionParser);
  },
});

function normalizeProjectionField(
  key: string,
  fieldConfig: ProjectionFieldConfig<any, any>
): null | NormalizedProjectionField {
  // Analyze the field configuration:
  const value: unknown = fieldConfig;
  if (value instanceof GroqBuilder) {
    const query = isConditional(key) // Conditionals can ignore the key
      ? value.query
      : key === value.query // Use shorthand syntax
      ? key
      : `"${key}": ${value.query}`;
    return { key, query, parser: value.parser };
  } else if (value === inferSymbol) {
    return { key, query: key, parser: null };
  } else if (typeof value === "string") {
    const query = key === value ? key : `"${key}": ${value}`;
    return { key, query, parser: null };
  } else if (isParser(value)) {
    return {
      key,
      query: key,
      parser: normalizeValidationFunction(value),
    };
  } else if (Array.isArray(value)) {
    const [projectionKey, parser] = value as [string, Parser];
    const query = key === projectionKey ? key : `"${key}": ${projectionKey}`;

    return {
      key,
      query,
      parser: normalizeValidationFunction(parser),
    };
  } else {
    throw new Error(
      `Unexpected value for projection key "${key}": "${typeof value}"`
    );
  }
}

type UnknownObject = Record<string, unknown>;

type NormalizedProjectionField = {
  key: string;
  query: string;
  parser: ParserFunction | null;
};

function createProjectionParser(
  fields: NormalizedProjectionField[]
): ParserFunction | null {
  if (!fields.some((f) => f.parser)) {
    // No nested parsers!
    return null;
  }

  // Parse all normal fields:
  const normalFields = fields.filter((f) => !isConditional(f.key));
  const objectShape = Object.fromEntries(
    normalFields.map((f) => [f.key, f.parser])
  );
  const objectParser = simpleObjectParser(objectShape);

  // Parse all conditional fields:
  const conditionalFields = fields.filter((f) => isConditional(f.key));
  const conditionalParsers = conditionalFields
    .map((f) => f.parser)
    .filter(notNull);

  // Combine normal and conditional parsers:
  const combinedParsers = [objectParser, ...conditionalParsers];
  const combinedParser = (input: Record<string, unknown>) => {
    const result = {};
    for (const p of combinedParsers) {
      const parsed = p(input);
      Object.assign(result, parsed);
    }
    return result;
  };

  // Finally, transparently handle arrays or objects:
  const arrayParser = simpleArrayParser(combinedParser);
  return function projectionParser(
    input: UnknownObject | Array<UnknownObject>
  ) {
    // Operates against either an array or a single item:
    if (!Array.isArray(input)) {
      return combinedParser(input);
    }

    return arrayParser(input);
  };
}
