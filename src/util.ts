import { z } from "zod";

export const safeZodArray = <T extends z.ZodTypeAny>(schema: T) => {
  const isValid = (item: unknown) => schema.safeParse(item).success;

  return z.preprocess(
    (val) => toSafeArray(val).filter(isValid),
    z.array(schema)
  );
};

export const isSafeZodArray = (el: unknown): el is SafeZodArray<any> =>
  el instanceof z.ZodEffects && el.innerType() instanceof z.ZodArray;

export type SafeZodArray<T extends z.ZodTypeAny> = z.ZodEffects<
  z.ZodArray<T, "many">,
  z.ZodArray<T, "many">["_output"],
  unknown
>;

const toSafeArray = <T>(item: T | T[]): T[] =>
  Array.isArray(item) ? item : [item];
