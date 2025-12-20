/**
 * Box component with borders
 */
import React from "react";
import { Box as InkBox, Text } from "ink";
import { colors } from "../utils/theme";

interface BoxProps {
  title?: string;
  children: React.ReactNode;
  width?: number | string;
  height?: number | string;
  borderColor?: string;
  padding?: number;
}

export default function Box({
  title,
  children,
  width,
  height,
  borderColor = colors.border,
  padding = 1,
}: BoxProps) {
  return (
    <InkBox
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={borderColor}
      paddingX={padding}
    >
      {title && (
        <InkBox marginBottom={1}>
          <Text bold color={colors.primary}>
            {title}
          </Text>
        </InkBox>
      )}
      {children}
    </InkBox>
  );
}
