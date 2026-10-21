export const forum = {
  name: 'Форум національної ідентичності',
  date: '27–28 листопада 2026',
  city: 'Київ',
  email: 'patrioticnamolodukraini@gmail.com',
  description:
    'Два дні діалогу про те, хто ми, що нас об’єднує та яку Україну ми творимо. Форум від Патріотичної молоді України. 27–28 листопада 2026, Київ.',
  consentVersion: '2026-10-20',
};

export const themes = [
  {
    title: 'Українська національна ідентичність',
    description: 'Що нас об’єднує та як змінюється наше відчуття належності.',
    tag: 'Самоусвідомлення',
  },
  {
    title: 'Історія та історична пам’ять',
    description: 'Як осмислювати минуле й берегти пам’ять, що формує нас.',
    tag: 'Пам’ять',
  },
  {
    title: 'Культура і мова',
    description: 'Українська мова та культура як живий простір нашої ідентичності.',
    tag: 'Культурний код',
  },
  {
    title: 'Молодь та державотворення',
    description: 'Від громадської ініціативи до відповідальності за майбутнє країни.',
    tag: 'Участь',
  },
  {
    title: 'Україна у світі',
    description: 'Якими нас бачать у світі та як ми розповідаємо власну історію.',
    tag: 'Суб’єктність',
  },
  {
    title: 'Інформаційний простір',
    description: 'Критичне мислення та практичні інструменти протидії маніпуляціям.',
    tag: 'Стійкість',
  },
  {
    title: 'Крим і кримськотатарська ідентичність',
    description: 'Голоси, культура та пам’ять Криму в спільному українському просторі.',
    tag: 'Спільний дім',
  },
] as const;

export const ages = ['16–17 років', '18–24 роки', '25 років і більше'] as const;
export const statuses = [
  'Учень / учениця',
  'Студент / студентка',
  'Працюю',
  'Представник / представниця громадського сектору',
  'Представник / представниця медіа',
  'Інше',
] as const;
export const sources = [
  'Instagram',
  'Telegram',
  'TikTok',
  'Друзі та знайомі',
  'Навчальний заклад',
  'Громадська організація',
  'Інше',
] as const;
export const formats = [
  'Лекція / виступ',
  'Інтерактивний воркшоп або тренінг',
  'Участь у панельній дискусії',
  'Виставка',
] as const;

export type FieldDefinition = {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'radio' | 'checkbox';
  required?: boolean;
  options?: readonly string[];
  hint?: string;
  autocomplete?: string;
  max?: number;
};
export type FormStep = { title: string; description: string; fields: FieldDefinition[] };

const contactFields: FieldDefinition[] = [
  {
    name: 'fullName',
    label: 'Прізвище та ім’я',
    type: 'text',
    required: true,
    autocomplete: 'name',
    max: 150,
  },
  {
    name: 'age',
    label: 'Ваш вік',
    type: 'radio',
    required: true,
    options: ages,
    hint: 'Участь у форумі — від 16 років.',
  },
  {
    name: 'city',
    label: 'Місто вашого проживання',
    type: 'text',
    required: true,
    autocomplete: 'address-level2',
    max: 150,
  },
  {
    name: 'occupation',
    label: 'Ваш поточний статус',
    type: 'radio',
    required: true,
    options: statuses,
  },
  {
    name: 'email',
    label: 'Контактна електронна пошта',
    type: 'email',
    required: true,
    autocomplete: 'email',
    hint: 'На цю адресу команда повідомить результат розгляду заявки.',
    max: 254,
  },
  { name: 'phone', label: 'Номер телефону', type: 'tel', autocomplete: 'tel', max: 25 },
];

export const participantSteps: FormStep[] = [
  {
    title: 'Познайомимося',
    description: 'Трохи про вас і контакти для зв’язку.',
    fields: contactFields,
  },
  {
    title: 'Ваші інтереси',
    description: 'Допоможіть нам зрозуміти вашу мотивацію та очікування.',
    fields: [
      {
        name: 'motivation',
        label: 'Чому ви хочете взяти участь у Форумі національної ідентичності?',
        type: 'textarea',
        required: true,
        max: 3000,
      },
      {
        name: 'experience',
        label:
          'Розкажіть про свій досвід у громадській діяльності, волонтерстві, молодіжній політиці або медіа.',
        type: 'textarea',
        max: 3000,
      },
      {
        name: 'interests',
        label: 'Які тематичні напрями форуму вас найбільше цікавлять?',
        type: 'checkbox',
        required: true,
        options: themes.map((t) => t.title),
        hint: 'Можна обрати кілька напрямів.',
      },
      {
        name: 'questions',
        label:
          'Які питання у сфері національної ідентичності України ви вважаєте найбільш актуальними сьогодні?',
        type: 'textarea',
        max: 3000,
      },
      {
        name: 'expectations',
        label: 'Що ви очікуєте отримати від участі у форумі?',
        type: 'textarea',
        required: true,
        max: 3000,
      },
    ],
  },
  {
    title: 'Останні деталі',
    description: 'Організаційні питання та ваші рішення щодо даних і зйомки.',
    fields: [
      {
        name: 'source',
        label: 'Звідки ви дізналися про форум?',
        type: 'radio',
        required: true,
        options: sources,
      },
      {
        name: 'needs',
        label: 'Чи маєте ви додаткові потреби або побажання щодо участі?',
        type: 'textarea',
        max: 2000,
        hint: 'Вкажіть лише те, що допоможе організувати вашу участь.',
      },
    ],
  },
];

export const speakerSteps: FormStep[] = [
  {
    title: 'Про вас',
    description: 'Познайомте команду з собою та своєю діяльністю.',
    fields: [
      {
        name: 'fullName',
        label: 'Прізвище, ім’я, по батькові',
        type: 'text',
        required: true,
        autocomplete: 'name',
        max: 150,
      },
      {
        name: 'occupation',
        label: 'Посада, місце роботи або основний вид діяльності',
        type: 'text',
        required: true,
        autocomplete: 'organization-title',
        max: 300,
      },
      {
        name: 'phone',
        label: 'Контактний номер телефону',
        type: 'tel',
        required: true,
        autocomplete: 'tel',
        max: 25,
      },
      {
        name: 'email',
        label: 'Електронна пошта',
        type: 'email',
        required: true,
        autocomplete: 'email',
        max: 254,
      },
    ],
  },
  {
    title: 'Ваш виступ',
    description: 'Розкажіть, чим ви хочете поділитися з учасниками.',
    fields: [
      {
        name: 'talkTopic',
        label: 'Тема вашого виступу',
        type: 'textarea',
        required: true,
        max: 3000,
        hint: 'Опишіть тему в межах концепції форуму. Це допоможе нам інтегрувати її в програму.',
      },
      {
        name: 'format',
        label: 'Який формат взаємодії з аудиторією ви плануєте?',
        type: 'radio',
        required: true,
        options: formats,
        hint: 'Оберіть один формат.',
      },
      {
        name: 'projector',
        label: 'Чи потрібні вам екран та проєктор для презентації?',
        type: 'radio',
        required: true,
        options: ['Так', 'Ні'],
      },
    ],
  },
  {
    title: 'Останні деталі',
    description: 'Ваші побажання та згоди.',
    fields: [
      {
        name: 'needs',
        label: 'Чи маєте ви додаткові потреби або побажання щодо участі?',
        type: 'textarea',
        max: 2000,
      },
    ],
  },
];
