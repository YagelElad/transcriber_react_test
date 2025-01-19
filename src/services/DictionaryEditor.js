import React, { useState, useMemo } from 'react';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const LoadingSpinner = () => (
  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

const SortIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 15l5 5 5-5"/>
    <path d="M7 9l5-5 5 5"/>
  </svg>
);

const DictionaryEditor = () => {
  const [isEditing, setIsEditing] = useState(false);
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [newEntry, setNewEntry] = useState({
    phrase: '',
    soundsLike: '',
    ipa: '',
    displayAs: ''
  });

  const ddbClient = useMemo(() => new DynamoDBClient({
    region: process.env.REACT_APP_AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY
    }
  }), []);

  const docClient = useMemo(() => DynamoDBDocumentClient.from(ddbClient), [ddbClient]);

  const loadDictionary = async () => {
  setIsLoading(true);
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: "transcriber-medical-test",
      Select: "ALL_ATTRIBUTES"
    }));

    console.log('Response:', response);
    console.log('Items:', response.Items);

    if (response.Items?.length) {
      setEntries(response.Items);
      setIsEditing(true);
    } else {
      setError('No items found in table');
    }
  } catch (error) {
    console.error('Error:', error);
    setError('Error: ' + error.message);
  }
  setIsLoading(false);
};

  const saveDictionary = async () => {
    setIsSaving(true);
    try {
      await Promise.all(entries.map(entry =>
        docClient.send(new PutCommand({
          TableName: "transcriber-medical-test",
          Item: entry
        }))
      ));
      setIsEditing(false);
    } catch (error) {
      console.error('Error:', error);
      setError('שגיאה בשמירת המילון');
    }
    setIsSaving(false);
  };

  const deleteEntry = async (index) => {
  const entry = entries[index];
  try {
    console.log('Deleting entry:', entry);

    await docClient.send(new DeleteCommand({
      TableName: "transcriber-medical-test",
      Key: {
        Phrase: entry.Phrase,
        DisplayAs: entry.DisplayAs  // Adding composite key if needed
      }
    }));

    const newEntries = [...entries];
    newEntries.splice(index, 1);
    setEntries(newEntries);
  } catch (error) {
    console.error('Delete request details:', {
      tableName: "transcriber-medical-test",
      key: entry
    });
    console.error('Error:', error);
    setError('שגיאה במחיקת רשומה');
  }
};

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedEntries = useMemo(() => {
    let result = [...entries];

    if (searchTerm) {
      const lowercasedSearch = searchTerm.toLowerCase();
      result = result.filter(entry =>
        Object.values(entry).some(value =>
          value?.toLowerCase().includes(lowercasedSearch)
        )
      );
    }

    if (sortConfig.key) {
      result.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    return result;
  }, [entries, searchTerm, sortConfig]);

  const addNewEntry = async () => {
  if (newEntry.phrase && newEntry.displayAs) {
    try {
      const item = {
        Phrase: newEntry.phrase,
        SoundsLike: newEntry.soundsLike || '',
        IPA: newEntry.ipa || '',
        DisplayAs: newEntry.displayAs
      };

      await docClient.send(new PutCommand({
        TableName: "transcriber-medical-test",
        Item: item
      }));

      setEntries([...entries, item]);
      setNewEntry({
        phrase: '',
        soundsLike: '',
        ipa: '',
        displayAs: ''
      });
    } catch (error) {
      console.error('Error:', error);
      setError('שגיאה בהוספת רשומה');
    }
  }
};

  return (
    <div className="relative">
      {!isEditing ? (
        <button
          onClick={loadDictionary}
          disabled={isLoading}
          className="btn-secondary w-full"
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <LoadingSpinner />
              טוען...
            </span>
          ) : (
            'עריכת מילון 📝'
          )}
        </button>
      ) : (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-6xl h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">עריכת מילון</h3>
              <button
                onClick={() => setIsEditing(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <CloseIcon />
              </button>
            </div>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 text-right">
                {error}
              </div>
            )}

            <div className="flex gap-4 mb-4">
              <div className="flex-1 relative">
                <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="חיפוש..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border rounded-md text-right"
                  dir="rtl"
                />
              </div>
              <button
                onClick={saveDictionary}
                disabled={isSaving}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? 'שומר...' : 'שמירה'}
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="תיקון"
                value={newEntry.phrase}
                onChange={(e) => setNewEntry({ ...newEntry, phrase: e.target.value })}
                className="flex-1 px-4 py-2 border rounded-md text-right"
                dir="rtl"
              />
              <input
                type="text"
                placeholder="נשמע כמו"
                value={newEntry.soundsLike}
                onChange={(e) => setNewEntry({ ...newEntry, soundsLike: e.target.value })}
                className="flex-1 px-4 py-2 border rounded-md text-right"
                dir="rtl"
              />
              <input
                type="text"
                placeholder="IPA"
                value={newEntry.ipa}
                onChange={(e) => setNewEntry({ ...newEntry, ipa: e.target.value })}
                className="flex-1 px-4 py-2 border rounded-md"
              />
              <input
                type="text"
                placeholder="להציג בתור"
                value={newEntry.displayAs}
                onChange={(e) => setNewEntry({ ...newEntry, displayAs: e.target.value })}
                className="flex-1 px-4 py-2 border rounded-md text-right"
                dir="rtl"
              />
              <button
                onClick={addNewEntry}
                className="p-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                <PlusIcon />
              </button>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-right p-4 border">
                      <button
                        className="flex items-center justify-end w-full"
                        onClick={() => handleSort('phrase')}
                      >
                        תיקון
                        <SortIcon className="mr-2" />
                      </button>
                    </th>
                    <th className="text-right p-4 border">
                      <button
                        className="flex items-center justify-end w-full"
                        onClick={() => handleSort('soundsLike')}
                      >
                        נשמע כמו
                        <SortIcon className="mr-2" />
                      </button>
                    </th>
                    <th className="text-right p-4 border">
                      <button
                        className="flex items-center justify-end w-full"
                        onClick={() => handleSort('ipa')}
                      >
                        IPA
                        <SortIcon className="mr-2" />
                      </button>
                    </th>
                    <th className="text-right p-4 border">
                      <button
                        className="flex items-center justify-end w-full"
                        onClick={() => handleSort('displayAs')}
                      >
                        להציג בתור
                        <SortIcon className="mr-2" />
                      </button>
                    </th>
                    <th className="w-[60px] p-4 border"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedEntries.map((entry, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="text-right p-4 border" dir="rtl">{entry.Phrase}</td>
                    <td className="text-right p-4 border" dir="rtl">{entry.SoundsLike || ''}</td>
                    <td className="text-left p-4 border">{entry.IPA || ''}</td>
                    <td className="text-right p-4 border" dir="rtl">{entry.DisplayAs}</td>
                    <td className="p-4 border">
                      <button
                        onClick={() => deleteEntry(index)}
                        className="p-1 text-red-500 hover:text-red-700 rounded"
                      >
                        <CloseIcon />
                      </button>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DictionaryEditor;
