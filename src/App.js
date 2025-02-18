import React, { useState, useRef, useCallback } from 'react';
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { FetchHttpHandler } from "@aws-sdk/fetch-http-handler";
import { Buffer } from 'buffer';
import S3Service, { createSessionId } from './services/S3Service';
import { aiAgentClean, aiAgentSummary } from './services/AgentService';
import AudioPlayer from './services/AudioPlayer';
import DictionaryEditor from './services/DictionaryEditor';
import { GetObjectCommand } from "@aws-sdk/client-s3";
import TextDisplay from './services/TextDisplay';
import TranscriptionConfig from './components/TranscriptionConfig';

const MedicalTranscription = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [isLoadingTranscription, setIsLoadingTranscription] = useState(false);

  const fileInputRef = useRef(null);
  const [sessionId, setSessionId] = useState(null);
  const recordedChunksRef = useRef([]);

  const partialTranscriptRef = useRef('');
  const completeTranscriptsRef = useRef([]);
  const currentSpeakerRef = useRef(null);
  
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const streamRef = useRef(null);
  const gainNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  const [isProcessingAI, setIsProcessingAI] = useState(false);

  const [language, setLanguage] = useState('he-IL');

  // -- New state to hold + edit the generated summary text --
  const [editedSummary, setEditedSummary] = useState('');

  const handleCleanText = async () => {
    if (!sessionId) {
      setError('No active session');
      return;
    }
    
    try {
      setIsProcessingAI(true);
      
      // Create a progress handler
      const handleProgress = (progressText) => {
        setTranscription(progressText);
      };
      
      await aiAgentClean(sessionId, handleProgress);
      
    } catch (error) {
      console.error('Error cleaning text:', error);
      // (Removed) setError('שגיאה בניקוי הטקסט');
    } finally {
      setIsProcessingAI(false);
    }
  };

  const handleAISummary = async () => {
    if (!sessionId) {
      setError('No active session');
      return;
    }
    
    try {
      setIsProcessingAI(true);
      
      // Create a progress handler
      const handleProgress = (progressText) => {
        setTranscription(progressText);
      };
      
      const summaryResult = await aiAgentSummary(sessionId, handleProgress);
      
      // -- Once summary is complete, put it into "editedSummary" --
      setEditedSummary(summaryResult);

    } catch (error) {
      console.error('Error generating summary:', error);
      // (Removed) setError('שגיאה ביצירת סיכום');
    } finally {
      setIsProcessingAI(false);
    }
  };

  // -- New function to save the edited summary to S3, overwriting old one --
  const handleLoadEditedSummary = async () => {
    if (!sessionId || !editedSummary) return;

    try {
      setIsProcessingAI(true);

      // We'll reuse the same S3 logic that aiAgentSummary uses
      const summaryData = {
        sessionId,
        timestamp: new Date().toISOString(),
        summary: editedSummary,
        originalText: transcription // or you could store the raw text again
      };

      await S3Service.saveToS3(
        'ai.hadassah.frankfurt',
        `ai-summaries/${sessionId}.json`,
        JSON.stringify(summaryData, null, 2),
        'application/json'
      );

      // Optionally also show the updated text on screen
      setTranscription(editedSummary);
      console.log('Updated summary saved successfully');
    } catch (err) {
      console.error('Error saving updated summary:', err);
      setError(`Error saving edited summary: ${err.message}`);
    } finally {
      setIsProcessingAI(false);
    }
  };

  const loadTranscription = async (sessionId) => {
    setIsLoadingTranscription(true);
    setError('');
    
    try {
      let attempts = 0;
      const maxAttempts = 120; // 4 minute total (2 second intervals)
      const pollInterval = 2000;

      const pollForTranscription = async () => {
        try {
          const transcriptionText = await S3Service.getFirstTranscription(sessionId);
          if (transcriptionText) {
            setTranscription(transcriptionText);
            return true;
          }
          return false;
        } catch (error) {
          console.log('Polling attempt failed:', error);
          return false;
        }
      };

      const poll = async () => {
        if (attempts >= maxAttempts) {
          throw new Error('Timeout waiting for transcription');
        }
        console.log(`Polling attempt ${attempts + 1}/${maxAttempts} for session ${sessionId}`);
        const found = await pollForTranscription();
        if (!found) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          return poll();
        }
      };

      await poll();
    } catch (error) {
      console.error('Error loading transcription:', error);
      setError(`Failed to load transcription: ${error.message}`);
    } finally {
      setIsLoadingTranscription(false);
    }
  };

  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // List of supported audio MIME types including all MPEG variations
    const supportedAudioTypes = [
      'audio/mpeg',      // MP3/MPEG files
      'audio/x-mpeg',    // Alternative MPEG MIME type
      'video/mpeg',      // MPEG files sometimes use video MIME type
      'audio/mpeg3',     // Alternative MPEG3 MIME type
      'audio/x-mpeg3',   // Alternative MPEG3 MIME type
      'audio/mp3',       // MP3 files
      'audio/x-mp3',     // Alternative MP3 MIME type
      'audio/mp4',       // M4A files
      'audio/wav',       // WAV files
      'audio/x-wav',     // Alternative WAV MIME type
      'audio/webm',      // WebM audio
      'audio/ogg',       // OGG files
      'audio/aac',       // AAC files
      'audio/x-m4a'      // Alternative M4A MIME type
    ];

    // Check if file type is directly supported
    let isSupported = supportedAudioTypes.includes(file.type);

    // If not directly supported, check file extension for .mpeg files
    if (!isSupported && file.name) {
      const extension = file.name.toLowerCase().split('.').pop();
      if (extension === 'mpeg') {
        isSupported = true;
      }
    }

    if (!isSupported) {
      setError('Please select a supported audio file (MPEG, MP3, WAV, M4A, WebM, OGG, AAC)');
      return;
    }

    setSelectedFileName(file.name);
    setUploadingFile(true);
    setError('');

    try {
      const newSessionId = createSessionId();
      setSessionId(newSessionId);

      // Log file information for debugging
      console.log('Uploading file:', {
        name: file.name,
        type: file.type,
        size: file.size,
        extension: file.name.split('.').pop()
      });

      // Upload file to S3
      await S3Service.uploadMedia(file, newSessionId);

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setSelectedFileName(`Uploaded: ${file.name}`);
      console.log('Starting transcription polling for session:', newSessionId);

      // Start loading the transcription
      await loadTranscription(newSessionId);

    } catch (error) {
      console.error('Error handling file:', error);
      setError('Failed to process file: ' + error.message);
    } finally {
      setUploadingFile(false);
    }
  };

  const transcribeClient = new TranscribeStreamingClient({
    region: process.env.REACT_APP_AWS_REGION || 'eu-central-1',
    credentials: {
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY
    },
    requestHandler: {
      ...new FetchHttpHandler({
        requestTimeout: 600000
      }),
      metadata: {
        handlerProtocol: 'h2'
      }
    },
    extraRequestOptions: {
      duplex: 'half'
    }
  });

  const initializeAudioContext = useCallback(async () => {
    try {
      console.log('Initializing audio context...');
      if (!audioContextRef.current) {
        const context = new AudioContext({
          sampleRate: 16000,
          latencyHint: 'interactive'
        });

        // Create gain node
        gainNodeRef.current = context.createGain();
        gainNodeRef.current.gain.value = 5.0;

        // Create analyser node
        analyserRef.current = context.createAnalyser();
        analyserRef.current.fftSize = 2048;

        await context.audioWorklet.addModule('/audio-processor.js');
        audioContextRef.current = context;

        console.log('Audio context initialized with gain and analyser');
      }
      return true;
    } catch (error) {
      console.error('Audio initialization error:', error);
      setError('Failed to initialize audio: ' + error.message);
      return false;
    }
  }, []);

  const startTranscription = useCallback(async (stream) => {
    let isStreaming = true;
    const audioQueue = [];
    let accumulatedBytes = 0;
    let queueInterval;
  
    try {
      const source = audioContextRef.current.createMediaStreamSource(stream);
      workletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
  
      source.connect(workletNodeRef.current);
  
      workletNodeRef.current.port.onmessage = (event) => {
        if (event.data.audioData) {
          const audioData = event.data.audioData;
          const stats = event.data.stats;
  
          const buffer = Buffer.allocUnsafe(audioData.length * 2);
          for (let i = 0; i < audioData.length; i++) {
            buffer.writeInt16LE(audioData[i], i * 2);
          }
  
          if (stats.activeFrames > 0) {
            audioQueue.push(buffer);
          }
  
          setAudioLevel(Math.min(100, event.data.rms * 200));
        }
      };
  
      const audioStream = new ReadableStream({
        start(controller) {
          queueInterval = setInterval(() => {
            if (!isStreaming) {
              controller.close();
              return;
            }
  
            if (audioQueue.length > 0) {
              const chunk = audioQueue.shift();
              controller.enqueue(chunk);
              accumulatedBytes += chunk.length;
            }
          }, 5); // Reduced interval for faster processing
        },
        cancel() {
          isStreaming = false;
          clearInterval(queueInterval);
        }
      });
  
      const command = new StartStreamTranscriptionCommand({
        LanguageCode: language,
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: 16000,
        ShowSpeakerLabel: true,
        EnablePartialResultsStabilization: true,
        PartialResultsStability: 'low',
        VocabularyName: 'transcriber-he-punctuation',
        AudioStream: async function* () {
          const reader = audioStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                yield { AudioEvent: { AudioChunk: value } };
              }
            }
          } finally {
            reader.releaseLock();
          }
        }()
      });
  
      const response = await transcribeClient.send(command);
  
      // Initialize state with more efficient handling
      let currentTranscript = '';
      let lastPartialTimestamp = Date.now();
      completeTranscriptsRef.current = [];
      
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent?.Transcript?.Results?.[0]) {
          const result = event.TranscriptEvent.Transcript.Results[0];
          
          if (result.Alternatives?.[0]) {
            const alternative = result.Alternatives[0];
            const newText = alternative.Transcript || '';
            
            // Handle speaker labels
            let speakerLabel = '';
            if (alternative.Items?.length > 0) {
              const speakerItem = alternative.Items.find(item => item.Speaker);
              if (speakerItem) {
                speakerLabel = `[דובר ${Math.min(Number(speakerItem.Speaker) + 1, 2)}]: `;
              }
            } else if (result.Speaker) {
              speakerLabel = `[דובר ${Math.min(Number(result.Speaker) + 1, 2)}]: `;
            }
  
            // Update partial results more frequently
            const now = Date.now();
            const shouldUpdatePartial = now - lastPartialTimestamp > 100; // Update every 100ms
  
            if (result.IsPartial) {
              if (shouldUpdatePartial) {
                currentTranscript = newText;
                lastPartialTimestamp = now;
                
                // Immediately update UI with partial result
                const displayText = [
                  ...completeTranscriptsRef.current,
                  speakerLabel + currentTranscript
                ].filter(Boolean).join('\n');
                
                setTranscription(displayText);
              }
            } else {
              // For final results
              completeTranscriptsRef.current.push(speakerLabel + newText);
              currentTranscript = ''; // Reset current transcript
              
              // Always update UI immediately for final results
              const displayText = completeTranscriptsRef.current.join('\n');
              setTranscription(displayText);
            }
          }
        }
      }
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    } finally {
      clearInterval(queueInterval);
    }
  }, [isRecording, language]);

  const startRecording = async () => {
    console.log('Starting recording...');
    setError('');
    setIsProcessing(true);

    try {
      const initialized = await initializeAudioContext();
      if (!initialized) return;

      // Generate new session ID
      const newSessionId = createSessionId();
      setSessionId(newSessionId);
      recordedChunksRef.current = [];

      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });

      // Create MediaRecorder to save the audio
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      mediaRecorderRef.current.start();

      streamRef.current = stream;
      setIsRecording(true);
      await startTranscription(stream);
    } catch (error) {
      console.error('Recording error:', error);
      // Removed visible error assignment
    } finally {
      setIsProcessing(false);
    }
  };

  const clearTranscription = () => {
    // Refresh the page
    window.location.reload();
  };

  const stopRecording = useCallback(async () => {
    console.log('Stopping recording...');
    setIsRecording(false);
    setIsProcessing(true);

    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        await new Promise(resolve => {
          mediaRecorderRef.current.onstop = resolve;
        });
      }

      // Create audio blob from recorded chunks
      if (recordedChunksRef.current.length > 0) {
        const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/wav' });

        // Upload recording to S3
        await S3Service.uploadRecording(audioBlob, sessionId);

        // Upload transcription to S3
        await S3Service.uploadTranscription(transcription, sessionId);

        console.log('Successfully saved recording and transcription');
      }
    } catch (error) {
      console.error('Error saving recording:', error);
      setError('Failed to save recording: ' + error.message);
    } finally {
      // Clean up resources
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }

      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }

      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }

      if (audioContextRef.current?.state === 'running') {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
      setAudioLevel(0);
      setIsProcessing(false);
    }
  }, [sessionId, transcription]);

  return (
    <div className="min-h-screen bg-blue-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-4 md:p-6">
        <div className="flex justify-between items-center border-b-2 border-blue-300 pb-4 mb-6">
          <div className="flex items-center space-x-4">
            <img 
              src="https://upload.wikimedia.org/wikipedia/he/thumb/4/40/HadassahHospital2024.svg/512px-HadassahHospital2024.svg.png" 
              alt="Eladsoft Logo"
              className="h-10 object-contain"
            />
          </div>
          <h1 className="text-2xl md:text-3xl text-blue-800 text-right">
            👨‍⚕️ מערכת תמלול חכמה
          </h1>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 text-right" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        <TranscriptionConfig
          language={language}
          setLanguage={setLanguage}
          disabled={isRecording || isProcessing || uploadingFile}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg mb-6">
          <button
            onClick={startRecording}
            disabled={isRecording || isProcessing || uploadingFile}
            className="btn-primary relative"
          >
            {isProcessing ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" 
                    stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 
                      5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 
                      5.824 3 7.938l3-2.647z" />
                </svg>
                מתחיל...
              </span>
            ) : (
              'התחל הקלטה ▶️'
            )}
          </button>
          <button
            onClick={stopRecording}
            disabled={!isRecording}
            className="btn-primary"
          >
            עצור הקלטה ⏹️
          </button>
          <button
            onClick={clearTranscription}
            className="btn-primary"
          >
            תמלול חדש 🗑️
          </button>
          <div className="relative">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="audio/*"
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className={`btn-primary w-full flex items-center justify-center cursor-pointer ${
                uploadingFile ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {uploadingFile ? (
                <span className="flex items-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" 
                      stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0
                        12h4zm2 5.291A7.962 7.962 0 014 12H0c0 
                        3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  מעלה...
                </span>
              ) : (
                'העלאת קובץ 📁'
              )}
            </label>
            {selectedFileName && (
              <p className="text-sm text-gray-600 mt-2 text-right break-words">
                {selectedFileName}
              </p>
            )}
          </div>
        </div>

        {isRecording && (
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-200"
                style={{ width: `${Math.min(100, audioLevel)}%` }}
              />
            </div>
            <p className="text-sm text-gray-500 mt-1 text-right">
              רמת קול: {Math.round(audioLevel)}
            </p>
          </div>
        )}

        {(sessionId && !isRecording) && (
          <AudioPlayer
            sessionId={sessionId}
            recordingType={selectedFileName ? 'upload' : 'recording'}
          />
        )}

        {/* AI Processing Controls */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <button
            onClick={handleCleanText}
            disabled={!transcription || isProcessingAI}
            className={`btn-secondary ${(!transcription || isProcessingAI) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isProcessingAI ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" 
                    stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 
                      12h4zm2 5.291A7.962 7.962 0 014 12H0c0 
                      3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                מעבד...
              </span>
            ) : (
              'ניקוי טקסט 🧹'
            )}
          </button>
          <button
            onClick={handleAISummary}
            disabled={!transcription || isProcessingAI}
            className={`btn-secondary ${(!transcription || isProcessingAI) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isProcessingAI ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" 
                    stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 
                      5.373 0 12h4zm2 5.291A7.962 7.962 
                      0 014 12H0c0 3.042 1.135 5.824 3 
                      7.938l3-2.647z" />
                </svg>
                מעבד...
              </span>
            ) : (
              'סיכום AI 🤖'
            )}
          </button>
          <DictionaryEditor />
        </div>

        <div className="space-y-4">
          {/* Existing text display for the full transcript */}
          <TextDisplay text={transcription} sessionId={sessionId} />

          {/* -- New editable summary area (visible once summary is generated) -- */}
          {editedSummary && (
            <div className="bg-gray-50 p-4 rounded-lg shadow">
              <label className="block mb-2 text-gray-700 font-bold text-right">
                עריכת טקסט מסוכם:
              </label>
              <textarea
                className="w-full p-2 border rounded-md text-right"
                style={{ direction: 'rtl' }}
                rows={6}
                value={editedSummary}
                onChange={(e) => setEditedSummary(e.target.value)}
              />
              <button
                onClick={handleLoadEditedSummary}
                disabled={isProcessingAI}
                className={`btn-primary mt-2 ${isProcessingAI ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                טען טקסט מתוקן
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MedicalTranscription;
