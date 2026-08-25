import { TextInput, type StyleProp, type TextStyle } from "react-native";

export type EnterSendTextInputProps = Readonly<{
  accessibilityLabel?: string;
  value: string;
  onChangeText(value: string): void;
  onSend(value?: string): void;
  placeholder?: string;
  placeholderTextColor?: string;
  maxLength?: number;
  style?: StyleProp<TextStyle>;
}>;

export function EnterSendTextInput(props: EnterSendTextInputProps) {
  return <TextInput
    accessibilityLabel={props.accessibilityLabel}
    value={props.value}
    onChangeText={props.onChangeText}
    onSubmitEditing={(event) => props.onSend(event.nativeEvent.text)}
    multiline
    submitBehavior="submit"
    returnKeyType="send"
    placeholder={props.placeholder}
    placeholderTextColor={props.placeholderTextColor}
    maxLength={props.maxLength}
    style={props.style}
  />;
}
