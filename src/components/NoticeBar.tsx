import { useEffect } from 'react';
import { useUi } from '../uiStore';

export default function NoticeBar() {
  const notice = useUi((s) => s.notice);
  const clearNotice = useUi((s) => s.clearNotice);
  useEffect(() => {
    if (!notice) return;
    const token = notice.token;
    const t = setTimeout(() => clearNotice(token), 4000);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);
  if (!notice) return null;
  return (
    <div className={`notice-bar notice-${notice.kind}`} role="status" onClick={() => clearNotice()}>
      {notice.msg}
    </div>
  );
}
