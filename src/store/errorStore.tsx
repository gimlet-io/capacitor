import { createContext, useContext, createSignal, JSX } from "solid-js";

export interface ErrorDetails {
  message: string;
  type: 'api' | 'watch' | 'server';
  timestamp: Date;
  path?: string;
  statusCode?: number;
}

interface ErrorState {
  currentError: ErrorDetails | null;
  setError: (error: ErrorDetails | null) => void;
  clearError: () => void;
  setApiError: (message: string, path?: string, statusCode?: number) => void;
  setWatchError: (message: string, path?: string) => void;
  setServerError: (message: string) => void;
}

const ErrorContext = createContext<ErrorState>();

export function ErrorProvider(props: { children: JSX.Element }) {
  const [currentError, setCurrentError] = createSignal<ErrorDetails | null>(null);

  const setError = (error: ErrorDetails | null) => {
    setCurrentError(error);
  };

  const clearError = () => {
    setCurrentError(null);
  };

  const setApiError = (message: string, path?: string, statusCode?: number) => {
    console.log('Setting API error:', message);
    setError({
      message,
      type: 'api',
      timestamp: new Date(),
      path,
      statusCode
    });
  };

  const setWatchError = (message: string, path?: string) => {
    console.log('Setting watch error:', message);
    setError({
      message,
      type: 'watch',
      timestamp: new Date(),
      path
    });
  };

  const setServerError = (message: string) => {
    console.log('Setting server error:', message);
    setError({
      message,
      type: 'server',
      timestamp: new Date()
    });
  };

  const store: ErrorState = {
    get currentError() { return currentError(); },
    setError,
    clearError,
    setApiError,
    setWatchError,
    setServerError
  };

  return (
    <ErrorContext.Provider value={store}>
      {props.children}
    </ErrorContext.Provider>
  );
}

export function useErrorStore() {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error("useErrorStore must be used within an ErrorProvider");
  }
  return context;
} 