import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Backend, Profile } from './backend';
@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  backend = inject(Backend);
  page = signal('home');
  busy = signal(false);
  message = signal('');
  profiles = signal<Profile[]>([]);
  mine = signal<Profile | null>(null);
  photos = signal<{ name: string; url: string }[]>([]);
  email = '';
  password = '';
  signup = false;
  cityFilter = '';
  form = { display_name: '', age: 25, city: '', education: '', occupation: '', about: '' };
  constructor() {
    effect(() => {
      const user = this.backend.user();
      untracked(() => {
        if (user)
          void this.run(async () => {
            await this.backend.checkAdmin();
            await this.loadMine();
          });
        else {
          this.mine.set(null);
          this.profiles.set([]);
          this.photos.set([]);
          this.viewing.set(null);
          this.form = {
            display_name: '',
            age: 25,
            city: '',
            education: '',
            occupation: '',
            about: '',
          };
        }
      });
    });
  }
  async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      await action();
    } catch (e) {
      this.message.set(
        e instanceof Error
          ? e.message
          : (e as { message?: string })?.message || 'Something went wrong. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  async authenticate() {
    await this.run(async () => {
      const client = this.backend.client;
      if (!client)
        throw new Error(
          'The backend is not connected yet. Follow the setup guide to enable accounts.',
        );
      const result = this.signup
        ? await client.auth.signUp({ email: this.email, password: this.password })
        : await client.auth.signInWithPassword({ email: this.email, password: this.password });
      if (result.error) throw result.error;
      this.password = '';
      if (result.data.session) {
        await this.backend.checkAdmin();
        await this.loadMine();
        this.page.set('profile');
      } else this.message.set('Check your email to confirm your account, then sign in.');
    });
  }
  async logout() {
    await this.run(async () => {
      const { error } = await this.backend.client!.auth.signOut();
      if (error) throw error;
      this.page.set('home');
    });
  }
  async loadMine() {
    const { data, error } = await this.backend
      .client!.from('profiles')
      .select('*')
      .eq('id', this.backend.user()!.id)
      .maybeSingle();
    if (error) throw error;
    this.mine.set(data);
    if (data) {
      this.form = {
        display_name: data.display_name,
        age: data.age,
        city: data.city,
        education: data.education,
        occupation: data.occupation,
        about: data.about,
      };
      await this.loadPhotos();
    }
  }
  async save() {
    await this.run(async () => {
      const { error } = await this.backend
        .client!.from('profiles')
        .upsert({ id: this.backend.user()!.id, ...this.form });
      if (error) throw error;
      await this.loadMine();
      this.message.set('Profile submitted. It stays private until the admin approves it.');
    });
  }
  async navigate(page: string) {
    this.page.set(page);
    this.message.set('');
    if ((page === 'members' || page === 'admin') && this.backend.user())
      await this.run(async () => {
        const query = this.backend.client!.from('profiles').select('*').order('display_name');
        const { data, error } = await (page === 'admin'
          ? query.eq('status', 'pending')
          : query.eq('status', 'approved'));
        if (error) throw error;
        this.profiles.set(data || []);
      });
  }
  filtered() {
    return this.profiles().filter((p) =>
      p.city.toLowerCase().includes(this.cityFilter.toLowerCase()),
    );
  }
  async review(id: string, approve: boolean) {
    await this.run(async () => {
      const { error } = await this.backend.client!.rpc('review_profile', {
        target_id: id,
        approve,
        note: approve
          ? ''
          : 'Please review and complete your profile details and photos, then submit again.',
      });
      if (error) throw error;
      this.profiles.update((items) => items.filter((p) => p.id !== id));
      this.message.set(approve ? 'Profile approved.' : 'Profile returned for changes.');
    });
  }
  async loadPhotos() {
    const client = this.backend.client!;
    const id = this.backend.user()!.id;
    const { data, error } = await client.storage.from('profile-photos').list(id);
    if (error) throw error;
    const photos = await Promise.all(
      (data || [])
        .filter((x) => /^[1-5]\.webp$/.test(x.name))
        .map(async (x) => {
          const result = await client.storage
            .from('profile-photos')
            .createSignedUrl(`${id}/${x.name}`, 300);
          if (result.error) throw result.error;
          return { name: x.name, url: result.data.signedUrl };
        }),
    );
    this.photos.set(photos);
  }
  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.run(async () => {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error('Choose a JPG, PNG or WebP image under 10 MB.');
      const slot = [1, 2, 3, 4, 5].find((n) => !this.photos().some((p) => p.name === `${n}.webp`));
      if (!slot) throw new Error('You can have up to five photos. Remove one first.');
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Could not process this image.'))),
          'image/webp',
          0.8,
        ),
      );
      const { error } = await this.backend
        .client!.storage.from('profile-photos')
        .upload(`${this.backend.user()!.id}/${slot}.webp`, blob, { contentType: 'image/webp' });
      if (error) throw error;
      await this.loadMine();
      this.message.set('Photo added. Your profile is awaiting admin review.');
    });
    input.value = '';
  }
  async removePhoto(name: string) {
    await this.run(async () => {
      const { error } = await this.backend
        .client!.storage.from('profile-photos')
        .remove([`${this.backend.user()!.id}/${name}`]);
      if (error) throw error;
      await this.loadMine();
    });
  }
  async inspect(profile: Profile) {
    await this.run(async () => {
      const { data, error } = await this.backend
        .client!.storage.from('profile-photos')
        .list(profile.id);
      if (error) throw error;
      const items = await Promise.all(
        (data || [])
          .filter((x) => /^[1-5]\.webp$/.test(x.name))
          .map(async (x) => {
            const { data, error } = await this.backend
              .client!.storage.from('profile-photos')
              .createSignedUrl(`${profile.id}/${x.name}`, 300);
            if (error) throw error;
            return { name: x.name, url: data.signedUrl };
          }),
      );
      this.viewing.set({ profile, photos: items });
    });
  }
  viewing = signal<{ profile: Profile; photos: { name: string; url: string }[] } | null>(null);
}
