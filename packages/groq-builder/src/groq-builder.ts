import type {
  IGroqBuilder,
  Parser,
  ParserFunction,
} from "./types/public-types";
import type { ExtractTypeNames, RootConfig } from "./types/schema-types";
import {
  chainParsers,
  normalizeValidationFunction,
} from "./commands/validate-utils";
import { ValidationErrors } from "./validation/validation-errors";
import { Empty } from "./types/utils";
import { GroqBuilderResultType } from "./types/public-types";

export type RootResult = Empty;

export type GroqBuilderOptions = {
  /**
   * Enables "pretty printing" for the compiled GROQ string. Useful for debugging.
   * @default "" (disabled)
   */
  indent?: string;
  /**
   * If enabled, then runtime validation is always required for all fields.
   * If missing, an error will be thrown when the query is created.
   *
   * This affects the following 3 APIs where validation is normally optional:
   *
   * q.project({
   *   example: true, // ⛔️ use a validation function instead
   *   example: q.string(), // ✅
   *
   *   example: "example.current", // ⛔️ use a tuple instead
   *   example: ["example.current", q.string()], // ✅
   *
   *   example: q.field("example.current"), // ⛔️ ensure you pass the 2nd validation parameter
   *   example: q.field("example.current", q.string()), // ✅
   * })
   *
   * @default false
   */
  validationRequired?: boolean;
};

export class GroqBuilder<
  TResult = any,
  TRootConfig extends RootConfig = RootConfig
> implements IGroqBuilder<TResult>
{
  // @ts-expect-error --- This property doesn't actually exist, it's only used to capture type info
  readonly [GroqBuilderResultType]: TResult;

  /**
   * Extends the GroqBuilder class by implementing methods.
   * This allows for this class to be split across multiple files in the `./commands/` folder.
   * @internal
   */
  static implement(methods: Partial<GroqBuilder>) {
    Object.assign(GroqBuilder.prototype, methods);
  }

  /**
   * Extends the GroqBuilder class by implementing properties.
   * This allows for this class to be split across multiple files in the `./commands/` folder.
   * @internal
   */
  static implementProperties(properties: {
    [P in keyof GroqBuilder]?: PropertyDescriptor;
  }) {
    Object.defineProperties(
      GroqBuilder.prototype,
      properties as PropertyDescriptorMap
    );
  }

  constructor(
    protected readonly internal: {
      readonly query: string;
      readonly parser: null | ParserFunction;
      readonly options: GroqBuilderOptions;
    }
  ) {}

  /**
   * The GROQ query as a string
   */
  public get query() {
    return this.internal.query;
  }

  /**
   * The parser function that should be used to parse result data
   */
  public get parser(): null | ParserFunction<unknown, TResult> {
    return this.internal.parser;
  }

  /**
   * Parses and validates the query results, passing all data through the parsers.
   */
  public parse(data: unknown): TResult {
    const parser = this.internal.parser;
    if (!parser) {
      return data as TResult;
    }
    try {
      return parser(data);
    } catch (err) {
      // Ensure we throw a ValidationErrors instance:
      if (err instanceof ValidationErrors) {
        throw err.withMessage();
      }
      const v = new ValidationErrors();
      v.add("", data, err as Error);
      throw v.withMessage();
    }
  }

  /**
   * Returns a new GroqBuilder, extending the current one.
   *
   * For internal use.
   */
  protected chain<TResultNew = never>(
    query: string,
    parser: Parser | null = null
  ): GroqBuilder<TResultNew, TRootConfig> {
    return new GroqBuilder({
      query: this.internal.query + query,
      parser: chainParsers(
        this.internal.parser,
        normalizeValidationFunction(parser)
      ),
      options: this.internal.options,
    });
  }

  /**
   * Returns an empty GroqBuilder
   */
  public get root() {
    let options = this.internal.options;
    // Make the query pretty, if needed:
    if (options.indent) {
      options = { ...options, indent: options.indent + "  " };
    }

    return new GroqBuilder<RootResult, TRootConfig>({
      query: "",
      parser: null,
      options: options,
    });
  }

  /**
   * Returns a GroqBuilder, overriding the result type.
   */
  public as<TResultNew>(): GroqBuilder<TResultNew, TRootConfig> {
    return this as any;
  }

  /**
   * Returns a GroqBuilder, overriding the result type
   * with the specified document type.
   */
  public asType<
    _type extends ExtractTypeNames<TRootConfig["documentTypes"]>
  >(): GroqBuilder<
    Extract<TRootConfig["documentTypes"], { _type: _type }>,
    TRootConfig
  > {
    return this as any;
  }

  /**
   * This utility returns whitespace, if 'indent' is enabled.
   */
  protected get indentation() {
    const indent = this.internal.options.indent;
    return {
      newLine: indent ? `\n${indent}` : " ",
      space: indent ? "  " : "",
    };
  }
}
