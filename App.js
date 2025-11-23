import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, Image, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { API_URL, API_KEY } from './config';

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resultImageUri, setResultImageUri] = useState(null);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso à galeria para selecionar a imagem.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setImage(asset);
    }
  };

  const submit = async () => {
    console.log('[submit] Clicked', {
      API_URL,
      hasImage: !!image,
      promptLen: prompt?.trim()?.length || 0,
    });
    if (!image) {
      Alert.alert('Selecione uma imagem', 'Por favor selecione uma imagem de referência.');
      return;
    }
    if (!prompt.trim()) {
      Alert.alert('Descreva a edição', 'Digite o texto com as instruções de edição.');
      return;
    }
    if (!API_URL || API_URL.includes('exemplo.com')) {
      Alert.alert('Configure a API', 'Atualize o arquivo config.js com a URL da sua API.');
      return;
    }

    try {
      setLoading(true);
      setResultImageUri(null);

      const formData = new FormData();
      formData.append('prompt', prompt);

      const uri = image.uri;
      const fileName = uri.split('/').pop() || `upload.jpg`;
      const fileType = image.mimeType || 'image/jpeg';
      console.log('[submit] Preparing payload', { fileName, fileType, uri });

      if (Platform.OS === 'web') {        const resp = await fetch(uri);
        const blob = await resp.blob();
        const webType = blob.type || fileType;
        const file = new File([blob], fileName, { type: webType });
        formData.append('image', file);
        console.log('[submit] Appended web File', { fileName, webType, size: blob.size });
      } else {
        // Em dispositivos nativos, o objeto com uri/name/type é aceito
        formData.append('image', {
          uri,
          name: fileName,
          type: fileType,
        });
      }

      const headers = { 'Accept': 'application/json' };
      if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

      console.log('[submit] Sending fetch', { API_URL, headers: Object.keys(headers) });
      const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: formData,
      });

      console.log('[submit] Response received', {
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get('content-type'),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.log('[submit] Non-OK response body', txt);
        throw new Error(`Erro ${res.status}: ${txt}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('A API deve retornar JSON com "imageUrl" ou "imageBase64".');
      }

      const data = await res.json();
      console.log('[submit] Parsed JSON', data);
      if (data && data.imageUrl) {
        console.log('[submit] Using imageUrl');
        setResultImageUri(data.imageUrl);
      } else if (data && data.imageBase64) {
        console.log('[submit] Using imageBase64');
        setResultImageUri(`data:image/png;base64,${data.imageBase64}`);
      } else {
        Alert.alert('Resposta inesperada', 'A API retornou JSON sem campo de imagem (imageUrl ou imageBase64).');
      }
    } catch (e) {
      console.error('[submit] Error', e);
      Alert.alert('Falha ao enviar', String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ateliê - Edição de Imagem</Text>

      <TextInput
        style={styles.input}
        placeholder="Descreva a edição desejada"
        value={prompt}
        onChangeText={setPrompt}
        multiline
      />

      <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.preview} />
        ) : (
          <Text style={styles.imagePickerText}>Selecionar imagem de referência</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enviar para edição</Text>}
      </TouchableOpacity>

      {resultImageUri ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>Resultado</Text>
          <Image
            source={{ uri: resultImageUri }}
            style={styles.resultImage}
            resizeMode="contain"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  imagePicker: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    overflow: 'hidden',
  },
  imagePickerText: { color: '#666' },
  preview: { width: '100%', height: '100%', resizeMode: 'cover' },
  button: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  resultBox: { marginTop: 16, gap: 8 },
  resultTitle: { fontSize: 16, fontWeight: '600' },
  resultImage: { width: '100%', aspectRatio: 1, borderRadius: 8 },
});
