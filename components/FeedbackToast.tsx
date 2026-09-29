"use client";
import { useEffect } from "react";
import { Icon } from "./StudioUI";
export function FeedbackToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  if (!message) return null;
  return <div className="embed-feedback-toast" role="status"><Icon name="check" size={18}/>{message}</div>;
}
