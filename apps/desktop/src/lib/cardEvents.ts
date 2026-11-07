import { onPermissionResolved, onQuestionResolved } from './events';

/** Another tab answered a permission card. */
export const onCardPermissionResolved = (cb: (requestId: string) => void) => onPermissionResolved(cb);
/** Another tab answered an agent question card. */
export const onCardQuestionResolved = (cb: (requestId: string) => void) => onQuestionResolved(cb);
