/** Desktop has a single window; these events are only needed when several tabs share one server. */
export const onCardPermissionResolved = (_cb: (requestId: string) => void): Promise<() => void> =>
  Promise.resolve(() => {});
export const onCardQuestionResolved = (_cb: (requestId: string) => void): Promise<() => void> =>
  Promise.resolve(() => {});
