"use client";

// 브라우저 기본 confirm() 대신 쓰는 앱 안 확인창.
// 앱 안 브라우저(Claude·Codex 데스크톱 등)나 "이 페이지의 대화상자 차단" 설정에서는
// window.confirm 이 창 없이 곧바로 false 를 돌려줘 삭제·재수집 버튼이 아무 반응 없이 끝난다.
// 네이티브 <dialog> 는 그런 환경에서도 뜬다.

type ConfirmOptions = {
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
};

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const danger = options.danger ?? /삭제|해제/.test(message);
  const confirmLabel = options.confirmLabel ?? (danger ? "삭제" : "진행");
  const cancelLabel = options.cancelLabel ?? "취소";

  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-confirm";
    dialog.setAttribute("aria-label", "확인");

    const text = document.createElement("p");
    text.className = "app-confirm-message";
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "app-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = cancelLabel;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = danger ? "btn btn-danger" : "btn btn-primary";
    ok.textContent = confirmLabel;
    actions.append(cancel, ok);
    dialog.append(text, actions);
    document.body.append(dialog);

    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
    });

    dialog.showModal();
    (danger ? cancel : ok).focus();
  });
}
