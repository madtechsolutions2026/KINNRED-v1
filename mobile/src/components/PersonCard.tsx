import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./AppText";
import { fontFamily } from "@/theme/tokens";
import type { NearbyPerson } from "@/lib/grid-api";
export function PersonCard({
  person,
  onPress,
  width,
  isSelf = false,
}: {
  person: NearbyPerson;
  onPress: () => void;
  width?: number;
  isSelf?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [person.photo?.url]);
  const image = !!person.photo && !failed;
  const locked = person.photosBlurred && !isSelf;
  const initials = (person.displayName ?? "K")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${isSelf ? "Your profile: " : ""}${person.displayName ?? "Nearby"}, ${person.age}${locked ? ", photos locked" : ""}${!image ? ", no photo" : ""}`}
      style={({ pressed }) => [
        styles.card,
        {
          width: width ?? "31%",
          transform: [{ scale: pressed ? 0.97 : 1 }],
          borderWidth: isSelf ? 2 : 0,
          borderColor: "#FF6336",
        },
      ]}
    >
      <LinearGradient
        colors={
          locked ? ["#D9CFCA", "#6D605C"] : ["#F9DED3", "#DFB6AA", "#957F7E"]
        }
        style={StyleSheet.absoluteFill}
      />
      {image ? (
        <Image
          source={{ uri: person.photo!.url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.placeholder}>
          <View style={styles.monogram}>
            <AppText style={styles.initials}>{initials}</AppText>
          </View>
          <Ionicons
            name={locked ? "lock-closed-outline" : "camera-outline"}
            size={17}
            color="#FFFFFF"
          />
        </View>
      )}
      <LinearGradient
        colors={["rgba(0,0,0,0.12)", "transparent", "rgba(0,0,0,0.78)"]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.top}>
        <Ionicons
          name={
            person.isVerified
              ? "shield-checkmark-outline"
              : "checkmark-circle-outline"
          }
          size={13}
          color="#FFFFFF"
        />
        {isSelf ? (
          <View style={styles.you}>
            <AppText style={styles.youText}>You</AppText>
          </View>
        ) : person.online ? (
          <View style={styles.online} />
        ) : null}
      </View>
      {locked && (
        <View style={styles.lockBadge}>
          <Ionicons name="lock-closed" size={10} color="#FFFFFF" />
          <AppText style={styles.lockText}>PHOTOS</AppText>
        </View>
      )}
      {!image && !locked && (
        <View style={styles.noPhoto}>
          <AppText style={styles.lockText}>
            {isSelf ? "ADD PHOTO" : "NO PHOTO"}
          </AppText>
        </View>
      )}
      <View style={styles.caption}>
        <AppText numberOfLines={1} style={styles.name}>
          {person.displayName ?? (isSelf ? "Your profile" : "Nearby")}{" "}
          <AppText style={styles.age}>{person.age}</AppText>
        </AppText>
        <AppText numberOfLines={1} style={styles.subtitle}>
          {isSelf
            ? "Edit your profile"
            : person.lookingFor[0]
              ? {
                  FRIENDSHIP: "Friends",
                  ACTIVITY_PARTNERS: "Activities",
                  JUST_EXPLORING: "Exploring",
                  DATING: "Dating",
                  NETWORKING: "Networking",
                }[person.lookingFor[0]]
              : "Nearby"}
        </AppText>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: {
    aspectRatio: 0.72,
    borderRadius: 18,
    overflow: "hidden",
    justifyContent: "space-between",
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 7,
    alignItems: "center",
  },
  online: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFA51F",
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },
  you: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  youText: { fontSize: 8, lineHeight: 11, color: "#C74B2D" },
  placeholder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 12,
  },
  monogram: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontFamily: fontFamily.bodySemibold,
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 30,
  },
  lockBadge: {
    position: "absolute",
    top: "47%",
    alignSelf: "center",
    flexDirection: "row",
    gap: 3,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  lockText: {
    color: "#FFFFFF",
    fontSize: 7,
    lineHeight: 10,
    letterSpacing: 0.8,
  },
  noPhoto: { position: "absolute", top: "67%", alignSelf: "center" },
  caption: { paddingHorizontal: 7, paddingBottom: 8, gap: 1 },
  name: {
    fontFamily: "LiberationSans-Bold",
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 16.3,
    letterSpacing: 0,
  },
  age: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    lineHeight: 16.3,
    fontFamily: "LiberationSans",
  },
  subtitle: { fontFamily:"LiberationSans", fontSize: 10, lineHeight: 12, color: "rgba(255,255,255,0.85)" },
});
