import React from 'react';

const TranscriptionConfig = ({ 
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
  );
};

export default TranscriptionConfig;
