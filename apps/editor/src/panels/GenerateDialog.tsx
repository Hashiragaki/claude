import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  Divider,
  Flex,
  Heading,
  Item,
  Picker,
  Radio,
  RadioGroup,
  TextArea,
  TextField,
  View,
} from '@adobe/react-spectrum';
import { useMemo, useState } from 'react';
import { ParamsForm } from '../components/ParamsForm';
import { generateAsset, toastError, useApp } from '../state/app';

/** Suggestions d'idées par générateur (pour aider à démarrer). */
const EXAMPLES: Record<string, string> = {
  'image.svg': 'Décor : une ruelle de Montmartre sous la pluie, néons roses et reflets sur les pavés',
  'image.pixel': 'Potion de soin rouge dans une fiole ronde en verre',
  charset: 'Chevalière aux cheveux roux en armure argentée',
  tileset: 'Donjon humide aux murs de pierre moussus',
  anim2d: 'Explosion magique bleue avec étincelles',
  sfx: 'Ramasser une pièce d\'or',
  music: 'Thème calme et mélancolique pour un village enneigé',
  model3d: 'Lanterne en fer forgé avec une flamme orange',
};

export function GenerateDialog(props: { onClose(): void; initialGenerator?: string }) {
  const generators = useApp((s) => s.generators);
  const aiEnabled = useApp((s) => s.health?.ai.enabled ?? false);
  const [generatorId, setGeneratorId] = useState(props.initialGenerator ?? generators[0]?.id ?? '');
  const generator = generators.find((g) => g.id === generatorId);
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [mode, setMode] = useState<'auto' | 'ai' | 'procedural'>(aiEnabled ? 'ai' : 'procedural');
  const [busy, setBusy] = useState(false);
  const example = EXAMPLES[generatorId] ?? '';
  const schema = useMemo(() => generator?.params ?? { properties: {} }, [generator]);

  const submit = async () => {
    if (!generator) return;
    setBusy(true);
    try {
      await generateAsset({
        generator: generator.id,
        prompt,
        params,
        mode,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(alias.trim() ? { alias: alias.trim() } : {}),
      });
      props.onClose();
    } catch (error) {
      toastError(error);
      setBusy(false);
    }
  };

  return (
    <Dialog size="L">
      <Heading>Générer un asset</Heading>
      <Divider />
      <Content>
        <Flex gap="size-300" wrap>
          <Flex direction="column" gap="size-150" flex="1 1 320px">
            <Picker
              label="Type d'asset"
              selectedKey={generatorId}
              onSelectionChange={(k) => {
                setGeneratorId(String(k));
                setParams({});
              }}
              width="100%"
            >
              {generators.map((g) => (
                <Item key={g.id} textValue={g.label}>
                  {g.label}
                </Item>
              ))}
            </Picker>
            <View UNSAFE_style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>{generator?.description}</View>
            <TextArea
              label="Description"
              value={prompt}
              onChange={setPrompt}
              placeholder={example}
              width="100%"
              height="size-1600"
            />
            <RadioGroup label="Moteur de génération" orientation="horizontal" value={mode} onChange={(v) => setMode(v as typeof mode)}>
              <Radio value="ai" isDisabled={!aiEnabled}>
                IA (Claude)
              </Radio>
              <Radio value="procedural">Procédural</Radio>
              <Radio value="auto">Automatique</Radio>
            </RadioGroup>
            {!aiEnabled && (
              <View UNSAFE_style={{ fontSize: 12, color: 'var(--fg-warn)' }}>
                IA non configurée : la génération procédurale utilise les paramètres ci-contre (la description sert
                d'indice pour les mots-clés).
              </View>
            )}
            <Flex gap="size-100">
              <TextField label="Nom" value={name} onChange={setName} flex placeholder="Automatique" />
              <TextField label="Alias (scripts)" value={alias} onChange={setAlias} flex placeholder="ex. bg plage" />
            </Flex>
          </Flex>
          <View flex="1 1 260px" maxHeight="size-6000" overflow="auto" paddingEnd="size-100">
            <ParamsForm schema={schema} values={params} onChange={setParams} exclude={['prompt']} />
          </View>
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={props.onClose}>
          Annuler
        </Button>
        <Button variant="accent" onPress={() => void submit()} isPending={busy} isDisabled={!generator}>
          Générer
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
