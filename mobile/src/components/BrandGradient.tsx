import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
export function BrandGradient() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["#FF1A53", "#FF7A00"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[StyleSheet.absoluteFill, {borderRadius:999}]}
    />
  );
}
