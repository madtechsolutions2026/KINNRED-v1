import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Simple seconds countdown. `restart(n)` resets it; `secondsLeft` ticks to 0
 * and stops. Used for the OTP resend cooldown.
 */
export function useCountdown(initial: number) {
  const [secondsLeft, setSecondsLeft] = useState(initial);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(
    (n: number) => {
      stop();
      setSecondsLeft(n);
      timer.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            stop();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [stop],
  );

  useEffect(() => {
    start(initial);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { secondsLeft, restart: start };
}
