/**
 * Spinner component for loading states
 */
import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { colors, icons } from "../utils/theme";

interface SpinnerProps {
  label?: string;
}

export default function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % icons.spinner.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text>
      <Text color={colors.primary}>{icons.spinner[frame]}</Text>
      {label && <Text color={colors.muted}> {label}</Text>}
    </Text>
  );
}
