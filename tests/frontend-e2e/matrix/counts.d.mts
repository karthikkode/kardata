export declare function expectedRowCount(caseId: string, primary: string, state: string): number | null
export declare function expectedCountTexts(
  caseId: string,
  primary: string,
  state: string,
  countTextTemplate?: string,
): Array<{ text: string; exact: boolean }>
