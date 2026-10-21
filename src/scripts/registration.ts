const form = document.querySelector<HTMLFormElement>('#registration-form');
if (form) {
  const steps = Array.from(form.querySelectorAll<HTMLElement>('[data-step]'));
  const progress = Array.from(form.querySelectorAll<HTMLElement>('[data-progress]'));
  const back = form.querySelector<HTMLButtonElement>('[data-back]')!;
  const next = form.querySelector<HTMLButtonElement>('[data-next]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const message = form.querySelector<HTMLElement>('#form-message')!;
  const status = document.querySelector<HTMLElement>('[data-registration-status]')!;
  let current = 0;
  let registrationOpen = false;
  let sending = false;
  const submissionKey = crypto.randomUUID();

  function showStep(index: number, focus = true) {
    current = index;
    steps.forEach((step, i) => {
      step.hidden = i !== index;
    });
    progress.forEach((item, i) => {
      item.classList.toggle('complete', i < index);
      if (i === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    back.hidden = index === 0;
    next.hidden = index === steps.length - 1;
    submit.hidden = index !== steps.length - 1;
    message.hidden = true;
    if (focus) steps[index].querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    if (focus)
      document
        .querySelector('.form-panel')
        ?.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'start',
        });
  }

  function clearField(field: HTMLElement) {
    const error = field.querySelector<HTMLElement>('.field-error');
    if (error) error.textContent = '';
    field
      .querySelectorAll('[aria-invalid]')
      .forEach((input) => input.removeAttribute('aria-invalid'));
  }

  function validateStep(index: number) {
    let valid = true;
    let firstInvalid: HTMLElement | null = null;
    steps[index].querySelectorAll<HTMLElement>('[data-field]').forEach((field) => {
      clearField(field);
      const inputs = Array.from(
        field.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea'),
      );
      let error = '';
      if (field.dataset.required === 'true') {
        if (inputs.some((input) => input.type === 'checkbox' || input.type === 'radio')) {
          if (!inputs.some((input) => (input as HTMLInputElement).checked))
            error = 'Оберіть відповідь.';
        } else if (!inputs[0]?.value.trim()) error = 'Заповніть це поле.';
      }
      for (const input of inputs) {
        if (input.type === 'email' && input.value.trim() && !input.validity.valid)
          error = 'Вкажіть коректну електронну адресу.';
        if (
          input.type === 'tel' &&
          input.value.trim() &&
          !/^\+?[\d\s().-]{7,25}$/.test(input.value.trim())
        )
          error = 'Перевірте номер телефону, наприклад +380 99 123 45 67.';
        if (input.maxLength > 0 && input.value.length > input.maxLength)
          error = 'Скоротіть відповідь до дозволеної довжини.';
      }
      if (error) {
        valid = false;
        field.querySelector<HTMLElement>('.field-error')!.textContent = error;
        inputs.forEach((input) => input.setAttribute('aria-invalid', 'true'));
        firstInvalid ??= inputs[0] ?? null;
      }
    });
    if (firstInvalid) (firstInvalid as HTMLElement).focus();
    return valid;
  }

  form.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    const field = target.closest<HTMLElement>('[data-field]');
    if (field) clearField(field);
    const counter = form.querySelector<HTMLElement>(`[data-counter="${target.name}"]`);
    if (counter) counter.textContent = `${target.value.length} / ${target.maxLength}`;
  });
  next.addEventListener('click', () => {
    if (validateStep(current)) showStep(current + 1);
  });
  back.addEventListener('click', () => showStep(current - 1));

  fetch('/api/registration-status', { cache: 'no-store' })
    .then((response) => response.json())
    .then((data) => {
      registrationOpen = data.open === true;
      status.dataset.open = String(registrationOpen);
      submit.disabled = !registrationOpen;
    })
    .catch(() => {
      status.textContent =
        'Поки не вдалося перевірити доступність реєстрації. Спробуйте оновити сторінку пізніше.';
    });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    for (let i = 0; i < steps.length; i++) {
      if (!validateStep(i)) {
        showStep(i, false);
        validateStep(i);
        return;
      }
    }
    if (!registrationOpen) {
      message.textContent = 'Прийом заявок ще не відкрито. Стежте за оновленнями ПМУ.';
      message.hidden = false;
      message.focus();
      return;
    }
    sending = true;
    submit.disabled = true;
    back.disabled = true;
    submit.textContent = 'Надсилаємо…';
    message.hidden = true;
    const body: Record<string, unknown> = Object.fromEntries(new FormData(form));
    body.submissionKey = submissionKey;
    body.interests = new FormData(form).getAll('interests');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.errors) {
          let firstStep: number | undefined;
          for (const [name, error] of Object.entries(result.errors)) {
            const field = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
            if (!field) continue;
            field.querySelector<HTMLElement>('.field-error')!.textContent = String(error);
            field
              .querySelectorAll('input,textarea')
              .forEach((input) => input.setAttribute('aria-invalid', 'true'));
            firstStep ??= Number(field.closest<HTMLElement>('[data-step]')!.dataset.step);
          }
          if (firstStep !== undefined) showStep(firstStep);
        }
        throw new Error(result.message || 'Не вдалося надіслати заявку. Спробуйте ще раз.');
      }
      form.hidden = true;
      status.hidden = true;
      const success = document.querySelector<HTMLElement>('[data-success]')!;
      success.hidden = false;
      success.querySelector<HTMLElement>('[data-reference]')!.textContent =
        `Номер заявки: ${String(result.id).slice(0, 8).toUpperCase()}`;
      success.focus();
    } catch (error) {
      message.textContent =
        error instanceof Error && error.name !== 'AbortError'
          ? error.message
          : 'З’єднання перервалося. Спробуйте надіслати ще раз: повторна спроба не створить дубль заявки.';
      message.hidden = false;
      message.focus();
    } finally {
      clearTimeout(timeout);
      sending = false;
      submit.disabled = !registrationOpen;
      back.disabled = false;
      submit.textContent = 'Надіслати заявку ↗';
    }
  });
}
