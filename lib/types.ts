export type Field = {
  name: string;
  type: string;
  key: string;
  nullable: boolean;
  description?: string;
};
export type Table = { name: string; description?: string; fields: Field[] };
export type Group = { id: string; name: string; tables: string[] };
