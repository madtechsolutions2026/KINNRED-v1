import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from './api';
import { getMyProfile, type MyProfile } from './users-api';
import { useAuth } from './auth';

interface ProfileContextValue {
  profile: MyProfile | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Replace the cached profile (e.g. with the response of a PATCH). */
  set: (next: MyProfile) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const p = await getMyProfile();
      setProfile(p);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Couldn’t load your profile.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'signedIn') {
      setLoading(true);
      void reload();
    } else if (status === 'signedOut') {
      setProfile(null);
      setLoading(false);
    }
  }, [status, reload]);

  const value = useMemo<ProfileContextValue>(
    () => ({ profile, loading, error, reload, set: setProfile }),
    [profile, loading, error, reload],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within <ProfileProvider>');
  return ctx;
}
