import { KeyboardTextInput } from "./KeyboardLayout";
import { type StyleProp, type TextStyle } from "react-native";

export type EnterSendTextInputProps = Readonly<{
  accessibilityLabel?: string;
  editable?: boolean;
  value: string;
  onChangeText(value: string): void;
  onSend(value?: string): void;
  placeholder?: string;
  placeholderTextColor?: string;
  maxLength?: number;
  style?: StyleProp<TextStyle>;
}>;

export function EnterSendTextInput(props: EnterSendTextInputProps) {
  return <KeyboardTextInput
    accessibilityLabel={props.accessibilityLabel}
    editable={props.editable}
    value={props.value}
    onChangeText={props.onChangeText}
    onSubmitEditing={(event) => props.editable !== false && props.onSend(event.nativeEvent.text)}
    multiline
    submitBehavior="submit"
    returnKeyType="send"
    placeholder={props.placeholder}
    placeholderTextColor={props.placeholderTextColor}
    maxLength={props.maxLength}
    style={props.style}
  />;
}
