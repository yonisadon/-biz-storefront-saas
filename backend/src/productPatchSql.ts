export const productPatchAssignment = (column: string, parameterIndex: number) =>
  `${column} = $${parameterIndex}${column === 'details' ? '::jsonb' : ''}`;
