import {
  useFocusEffect,
  useNavigation,
  usePreventRemove,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmDialog } from '../components/Dialog';
import { Button, NavBar } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { color } from '../theme';

export type LearningNav = NativeStackNavigationProp<RootStackParamList>;
export const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

export function useResource<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(v => v + 1), []);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError(null);
      loader()
        .then(value => {
          if (alive) {
            setData(value);
          }
        })
        .catch(e => {
          if (alive) {
            setError(messageOf(e));
          }
        });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version 是用户点击重试或保存后的显式刷新令牌。
    }, [loader, version]),
  );
  return { data, error, reload };
}

export function useAction() {
  const locked = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (alive.current) {
        setError(messageOf(e));
      }
    } finally {
      locked.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  };
  return { run, busy, error };
}

export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const nav = useNavigation();
  const [leave, setLeave] = useState<(() => void) | null>(null);
  usePreventRemove(dirty, ({ data }) =>
    setLeave(() => () => nav.dispatch(data.action)),
  );
  return (
    <ConfirmDialog
      visible={!!leave}
      title="有修改尚未保存"
      rows={[]}
      okTitle="放弃修改"
      okTone="plain"
      cancelTitle="继续编辑"
      onCancel={() => setLeave(null)}
      onOk={() => {
        const go = leave;
        setLeave(null);
        go?.();
      }}
    >
      <Text style={ls.body}>这次尚未保存的内容会丢失。</Text>
    </ConfirmDialog>
  );
}

export function LearningPage({
  title,
  sub,
  children,
  right,
  scrollRef,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  right?: ReactNode;
  scrollRef?: RefObject<ScrollViewInstance | null>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={ls.page}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <NavBar title={title} sub={sub} back right={right} />
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          ls.content,
          { paddingBottom: 28 + insets.bottom },
        ]}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function LoadState({
  error,
  loading,
  reload,
}: {
  error: string | null;
  loading: boolean;
  reload: () => void;
}) {
  return error ? (
    <View style={ls.block}>
      <Text style={ls.error} accessibilityRole="alert">
        加载失败：{error}
      </Text>
      <Button title="重新加载" onPress={reload} />
    </View>
  ) : loading ? (
    <Text style={ls.muted}>正在读取学习记录…</Text>
  ) : null;
}
export function ActionError({ error }: { error: string | null }) {
  return error ? (
    <Text style={ls.error} accessibilityRole="alert">
      {error}
    </Text>
  ) : null;
}
export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={ls.heading} accessibilityRole="header">
      {children}
    </Text>
  );
}
export function Entry({
  title,
  detail,
  onPress,
  trailing,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  trailing?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [ls.entry, pressed && ls.pressed]}
    >
      <View style={ls.grow}>
        <Text style={ls.title}>{title}</Text>
        {detail ? <Text style={ls.muted}>{detail}</Text> : null}
      </View>
      {trailing ? <Text style={ls.meta}>{trailing}</Text> : null}
      <ChevronRight size={19} color={rc.secondary} />
    </Pressable>
  );
}
export function Choice({
  title,
  detail,
  selected,
  onPress,
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        ls.choice,
        selected && ls.selected,
        pressed && ls.pressed,
      ]}
    >
      <Text style={[ls.title, selected && ls.link]}>{title}</Text>
      {detail ? <Text style={ls.muted}>{detail}</Text> : null}
    </Pressable>
  );
}
export function Input({
  label,
  value,
  onChange,
  hint,
  multiline = true,
  maxLength = 4000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={ls.field}>
      <Text style={ls.title}>{label}</Text>
      {hint ? <Text style={ls.muted}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        maxLength={maxLength}
        textAlignVertical="top"
        style={[ls.input, multiline && ls.multiline]}
        placeholderTextColor={rc.secondary}
      />
    </View>
  );
}

export const ls = StyleSheet.create({
  page: { flex: 1, backgroundColor: rc.page },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  hubContent: { paddingBottom: 28 },
  block: { gap: 12 },
  grow: { flex: 1 },
  hero: { fontSize: 24, lineHeight: 34, fontWeight: '600', color: rc.ink },
  heading: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '600',
    color: rc.ink,
    marginTop: 16,
  },
  title: { fontSize: 16, lineHeight: 25, fontWeight: '500', color: rc.ink },
  body: { fontSize: 16, lineHeight: 27, color: rc.ink },
  muted: { fontSize: 14, lineHeight: 23, color: rc.secondary },
  meta: { fontSize: 13, lineHeight: 21, color: rc.secondary, maxWidth: '28%' },
  link: { color: rc.main },
  error: { fontSize: 15, lineHeight: 24, color: color.warnInk },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 64,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: rc.line,
  },
  pressed: { opacity: 0.7 },
  choice: {
    minHeight: 48,
    justifyContent: 'center',
    padding: 12,
    gap: 3,
    borderWidth: 1,
    borderColor: rc.line,
    borderRadius: 12,
  },
  selected: { backgroundColor: rc.mainBg, borderColor: rc.main },
  field: { gap: 6 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: rc.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: rc.ink,
    fontSize: 16,
    lineHeight: 25,
    backgroundColor: rc.paper,
  },
  multiline: { minHeight: 100 },
  inset: { padding: 16, borderRadius: 12, backgroundColor: rc.soft, gap: 8 },
  actions: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
