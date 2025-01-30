import React from 'react';

const TranscriptionConfig = ({ 
  numSpeakers, 
  setNumSpeakers, 
  language, 
  setLanguage,
  disabled 
}) => {
  const languages = [
    { code: 'he-IL', name: 'עברית' }
   // { code: 'en-US', name: 'English' },
   // { code: 'ar-AE', name: 'العربية' },
   // { code: 'ru-RU', name: 'Русский' }
  ];

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm mb-4 border border-blue-200">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 text-right">
            מספר דוברים
          </label>
          <select
            value={numSpeakers}
            onChange={(e) => setNumSpeakers(Number(e.target.value))}
            disabled={disabled}
            className="block w-full rounded-md border border-gray-300 py-2 px-3 text-right disabled:opacity-50 disabled:cursor-not-allowed"
            dir="rtl"
          >
            {[1, 2, 3].map(num => (
              <option key={num} value={num}>
                {num} {num === 1 ? 'דובר' : 'דוברים'}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 text-right">
            שפה
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-md border border-gray-300 py-2 px-3 text-right disabled:opacity-50 disabled:cursor-not-allowed"
            dir="rtl"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default TranscriptionConfig;
