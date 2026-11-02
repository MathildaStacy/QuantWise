import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View, type ScrollViewInstance } from 'react-native';
import { exportText } from '../../app/exportFile';
import type { BookSection } from '../../book/types';
import * as bookRepo from '../../data/bookRepo';
import {
  deleteResearch,
  getResearch,
  loadResearch,
  saveResearch,
} from '../../data/learningRepo';
import { CHECKS, CONCEPTS, conceptById } from '../../learning/catalog';
import {
  checkCount,
  emptyResearch,
  researchMarkdown,
} from '../../learning/progress';
import type { ResearchDraft } from '../../learning/types';
import { ConfirmDialog } from '../components/Dialog';
import { Button, Details } from '../components/ui';
import { useCore } from '../hooks';
import type { RootScreenProps } from '../navigation/types';
import { toast } from '../toast';
import {
  ActionError,
  Choice,
  Entry,
  Heading,
  Input,
  LearningPage,
  LoadState,
  UnsavedGuard,
  ls,
  messageOf,
  useAction,
  useResource,
  type LearningNav,
} from './shared';

export function ResearchNotesScreen() {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const r = useResource(useCallback(() => loadResearch(core.db), [core]));
  const [query, setQuery] = useState('');
  const list =
    r.data?.filter(n =>
      [n.title, n.hypothesis, n.source?.bookTitle ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ) ?? [];
  return (
    <LearningPage title="研究手记">
      <Text style={ls.body}>先写可验证的假设，再留下支持或反对它的证据。</Text>
      <Button
        title="新建研究手记"
        tone="learn"
        onPress={() => nav.push('ResearchEdit', {})}
      />
      <Input
        label="搜索手记"
        value={query}
        onChange={setQuery}
        multiline={false}
        maxLength={100}
      />
      <LoadState error={r.error} loading={!r.data} reload={r.reload} />
      {r.data && !list.length ? (
        <Text style={ls.muted}>
          {query
            ? '没有匹配的手记，试试书名或假设关键词。'
            : '例如：短期反转在扣除双边费用后，是否仍有超额收益？'}
        </Text>
      ) : null}
      {list.map(n => (
        <Entry
          key={n.id}
          title={n.title}
          detail={
            n.updatedDay +
            ' · ' +
            (n.conclusion.trim() ? '已写结论' : '研究中') +
            ' · 自查依据 ' +
            checkCount(n) +
            '/4' +
            (n.source
              ? '\n《' + n.source.bookTitle + '》 · ' + n.source.sectionTitle
              : '')
          }
          onPress={() => nav.push('ResearchEdit', { id: n.id })}
        />
      ))}
    </LearningPage>
  );
}

export function ResearchEditScreen({ route }: RootScreenProps<'ResearchEdit'>) {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const id = route.params?.id;
  const r = useResource(
    useCallback(
      async () => ({
        note: id ? await getResearch(core.db, id) : null,
        books: (await bookRepo.books(core.db)).filter(
          b => b.status === 'ready',
        ),
      }),
      [core, id],
    ),
  );
  const [draft, setDraft] = useState<ResearchDraft | null>(null),
    [baseline, setBaseline] = useState('');
  const [exists, setExists] = useState(false),
    [remove, setRemove] = useState(false),
    [deleted, setDeleted] = useState(false);
  const [bookId, setBookId] = useState<string | null>(null),
    [sections, setSections] = useState<BookSection[]>([]),
    [sourceError, setSourceError] = useState<string | null>(null);
  const [sectionQuery, setSectionQuery] = useState('');
  const [sourceVersion, setSourceVersion] = useState(0);
  const initialized = useRef(false),
    a = useAction();
  const scrollRef = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (r.data && !initialized.current && (!id || r.data.note)) {
      const n = r.data.note;
      const value: ResearchDraft = n
        ? {
            id: n.id,
            title: n.title,
            hypothesis: n.hypothesis,
            method: n.method,
            evidence: n.evidence,
            conclusion: n.conclusion,
            nextStep: n.nextStep,
            conceptId: n.conceptId,
            source: n.source,
            checks: n.checks,
          }
        : emptyResearch(route.params?.conceptId);
      initialized.current = true;
      setDraft(value);
      setBaseline(JSON.stringify(value));
      setExists(!!n);
    }
  }, [r.data, id, route.params?.conceptId]);
  useEffect(() => {
    let alive = true;
    setSections([]);
    setSourceError(null);
    if (bookId) {
      bookRepo
        .sections(core.db, bookId)
        .then(s => {
          if (alive) {
            setSections(s.filter(x => x.leaf));
          }
        })
        .catch(e => {
          if (alive) {
            setSourceError(messageOf(e));
          }
        });
    }
    return () => {
      alive = false;
    };
  }, [bookId, core, sourceVersion]);
  useEffect(() => {
    if (deleted) {
      nav.goBack();
    }
  }, [deleted, nav]);
  const patch = (p: Partial<ResearchDraft>) =>
    setDraft(v => (v ? { ...v, ...p } : v));
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const save = () =>
    a.run(async () => {
      if (!draft) {
        return;
      }
      try {
        await saveResearch(core.db, draft);
        const saved = await getResearch(core.db, draft.id);
        const value = {
          ...draft,
          title: saved!.title,
          hypothesis: saved!.hypothesis,
          source: saved!.source,
        };
        setDraft(value);
        setBaseline(JSON.stringify(value));
        setExists(true);
        toast.show('研究手记已保存');
      } catch (e) {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        throw e;
      }
    });
  const openSource = () =>
    a.run(async () => {
      if (!draft?.source) {
        return;
      }
      const src = draft.source;
      const b = await bookRepo.book(core.db, src.bookId);
      if (
        b?.status !== 'ready' ||
        !(await bookRepo.sections(core.db, src.bookId)).some(
          s => s.id === src.sectionId && s.leaf,
        )
      ) {
        throw new Error('原书或小节已不可读，来源文字已保留，可以重新关联书籍');
      }
      nav.navigate('Study', {
        bookId: src.bookId,
        sectionId: src.sectionId,
        mode: 'read',
      });
    });
  return (
    <LearningPage
      title={exists ? '研究手记' : '新建研究手记'}
      scrollRef={scrollRef}
      right={
        <Button
          title={a.busy ? '处理中' : '保存'}
          small
          tone="learn"
          disabled={!draft || a.busy}
          onPress={save}
        />
      }
    >
      <LoadState error={r.error} loading={!r.data} reload={r.reload} />
      <ActionError error={a.error} />
      {r.data && id && !r.data.note && !draft ? (
        <Text style={ls.body}>这篇手记已被删除，请返回列表。</Text>
      ) : null}
      {draft ? (
        <>
          <Input
            label="标题"
            value={draft.title}
            onChange={title => patch({ title })}
            multiline={false}
            maxLength={120}
          />
          <Input
            label="研究假设"
            hint="什么条件下，预期出现什么现象？怎样的结果能否定它？"
            value={draft.hypothesis}
            onChange={hypothesis => patch({ hypothesis })}
          />
          <Input
            label="验证方法"
            hint="写清数据、区间、信号、基准与参数；可以记录电脑上执行的实验。"
            value={draft.method}
            onChange={method => patch({ method })}
          />
          <Input
            label="观察证据"
            hint="保留数值、样本日期或实验文件位置，也记录不符合预期的结果。"
            value={draft.evidence}
            onChange={evidence => patch({ evidence })}
          />
          <Input
            label="结论"
            value={draft.conclusion}
            onChange={conclusion => patch({ conclusion })}
          />
          <Input
            label="下一步"
            value={draft.nextStep}
            onChange={nextStep => patch({ nextStep })}
          />
          <Heading>实验质量自查</Heading>
          <Text style={ls.muted}>
            已记录 {checkCount(draft)} / 4
            项依据。这里记录你的检查过程，填写不代表实验已通过验证。
          </Text>
          {CHECKS.map(c => (
            <Input
              key={c.id}
              label={c.title}
              hint={c.hint}
              value={draft.checks[c.id]}
              maxLength={1200}
              onChange={text =>
                patch({ checks: { ...draft.checks, [c.id]: text } })
              }
            />
          ))}
          <Heading>关联知识与书籍</Heading>
          <Details
            title={
              '关联概念：' +
              (conceptById(draft.conceptId ?? '')?.title ?? '未选择')
            }
          >
            <View style={ls.block}>
              <Choice
                title="不关联概念"
                selected={!draft.conceptId}
                onPress={() => patch({ conceptId: null })}
              />
              {CONCEPTS.map(c => (
                <Choice
                  key={c.id}
                  title={c.title}
                  selected={draft.conceptId === c.id}
                  onPress={() => patch({ conceptId: c.id })}
                />
              ))}
            </View>
          </Details>
          {draft.source ? (
            <View style={ls.block}>
              <Text style={ls.body}>
                《{draft.source.bookTitle}》 · {draft.source.sectionTitle}
              </Text>
              <Button
                title="查看来源原文"
                onPress={openSource}
                disabled={a.busy}
              />
              <Button
                title="取消书籍关联"
                onPress={() => {
                  patch({ source: null });
                  setBookId(null);
                }}
              />
            </View>
          ) : (
            <Text style={ls.muted}>可以关联书架中的任意可读小节。</Text>
          )}
          <Details title="选择书籍与小节">
            <View style={ls.block}>
              {r.data?.books.map(b => (
                <Choice
                  key={b.id}
                  title={b.title}
                  selected={bookId === b.id}
                  onPress={() => {
                    setBookId(b.id);
                    setSectionQuery('');
                  }}
                />
              ))}
              {bookId ? (
                <Input
                  label="搜索来源小节"
                  value={sectionQuery}
                  onChange={setSectionQuery}
                  multiline={false}
                  maxLength={100}
                />
              ) : null}
              {sourceError ? (
                <View style={ls.block}>
                  <Text style={ls.error} accessibilityRole="alert">
                    小节加载失败：{sourceError}
                  </Text>
                  <Button
                    title="重新加载小节"
                    onPress={() => setSourceVersion(v => v + 1)}
                  />
                </View>
              ) : null}
              {sections
                .filter(s => (s.no + s.title).includes(sectionQuery.trim()))
                .map(s => (
                  <Choice
                    key={s.id}
                    title={[s.no, s.title].filter(Boolean).join(' ')}
                    selected={
                      draft.source?.bookId === bookId &&
                      draft.source.sectionId === s.id
                    }
                    onPress={() => {
                      const b = r.data!.books.find(x => x.id === bookId)!;
                      patch({
                        source: {
                          bookId: b.id,
                          sectionId: s.id,
                          bookTitle: b.title,
                          sectionTitle: s.title,
                        },
                      });
                    }}
                  />
                ))}
            </View>
          </Details>
          <Button
            title={a.busy ? '正在处理…' : '保存研究手记'}
            tone="learn"
            disabled={a.busy}
            onPress={save}
          />
          {exists ? (
            <View style={ls.actions}>
              <Text style={ls.muted}>
                {dirty
                  ? '保存修改后，可以将最新内容交给 AI 或导出。'
                  : '内容已保存到本机。'}
              </Text>
              <Button
                title="请 AI 追问这个假设"
                disabled={dirty || a.busy}
                onPress={() =>
                  nav.navigate('LearningCoach', { noteId: draft.id })
                }
              />
              <Button
                title="导出 Markdown"
                disabled={dirty || a.busy}
                onPress={() =>
                  a.run(async () => {
                    const note = await getResearch(core.db, draft.id);
                    if (!note) {
                      throw new Error('手记不存在，请返回列表');
                    }
                    await exportText(
                      note.title + '.md',
                      '# QuantWise 研究手记\n\n' + researchMarkdown(note),
                      'text/plain',
                    );
                  })
                }
              />
              <Button
                title="删除手记"
                disabled={a.busy}
                onPress={() => setRemove(true)}
              />
            </View>
          ) : null}
          <UnsavedGuard dirty={dirty && !deleted} />
          <ConfirmDialog
            visible={remove}
            title="删除这篇研究手记？"
            rows={[{ k: '标题', v: draft.title }]}
            okTitle="删除"
            onCancel={() => setRemove(false)}
            onOk={() => {
              setRemove(false);
              a.run(async () => {
                await deleteResearch(core.db, draft.id);
                setDeleted(true);
              });
            }}
          />
        </>
      ) : null}
    </LearningPage>
  );
}
